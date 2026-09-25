package app.ember.music

import android.content.ComponentName
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONArray
import org.json.JSONObject

/** `cachedIds`, `offlineStalled`, `offline` from the service's session
 *  extras; an older service (none published yet) reads as nothing cached,
 *  online. */
internal fun cacheState(extras: Bundle): Triple<List<String>, Boolean, Boolean> = Triple(
    extras.getStringArrayList(EmberPlaybackService.EXTRA_CACHED_IDS)?.toList() ?: emptyList(),
    extras.getBoolean(EmberPlaybackService.EXTRA_OFFLINE_STALLED, false),
    extras.getBoolean(EmberPlaybackService.EXTRA_OFFLINE, false),
)

/** setQueue's optional `context: { type }` and `baseCount`, as the service's
 *  COMMAND_QUEUE_CONTEXT args. Missing means no curated base (the car's
 *  default). */
internal fun queueContextArgs(data: JSONObject): Bundle = Bundle().apply {
    val ctx = data.optJSONObject("context")
    putString("contextType", ctx?.takeIf { it.has("type") && !it.isNull("type") }?.optString("type"))
    putInt("baseCount", data.optInt("baseCount", 0).coerceAtLeast(0))
}

/** `{ index, tracks }`: the native queue as the web app holds it. Both the
 *  `queue` event and getQueue send this. */
internal fun queueJs(items: List<MediaItem>, index: Int): JSObject = JSObject().apply {
    put("index", if (items.isEmpty()) -1 else index)
    put("tracks", JSArray(TrackItems.toJson(items).toString()))
}

/** Which native queue changes are news to the web app. The app's own
 *  setQueue comes back as timeline events (several while QueueSync applies
 *  one, then the service's confirmation); those are not. Anything else is:
 *  a tap in the car, or native radio, however soon after the app's last
 *  send. A time window used to decide this, and it swallowed native radio
 *  that landed within 1.5 s of a tap, which left the app one queue behind. */
internal class QueueEcho {
    /** Ids of the queue the web app has: the one it last sent, or the one it
     *  was last told about. */
    private var known: List<String>? = null
    /** True while QueueSync applies the app's queue: the steps in between
     *  are neither the old queue nor the new one. */
    var applying = false

    fun sent(ids: List<String>) { known = ids }

    /** True when [ids] must be reported (and it is then what the app has). */
    fun isNews(ids: List<String>): Boolean {
        if (applying || ids == known) return false
        known = ids
        return true
    }
}

/** The app's Previous button, as everywhere else in Ember (the web player,
 *  the notification, the car): past the first 3 s it starts the song over,
 *  before that it goes to the song before. It used to always go back a song. */
internal fun previous(player: Player) = player.seekToPrevious()

/** The web UI's handle on the native player. Commands in, state out.
 *
 *  Everything goes through a Media3 MediaController, the same door the car
 *  uses, so there is exactly one way to drive the player. */
@CapacitorPlugin(name = "EmberPlayer")
class EmberPlayerPlugin : Plugin() {
    private var controller: MediaController? = null
    private val main = Handler(Looper.getMainLooper())
    private val pending = ArrayList<(MediaController) -> Unit>()
    /** Keeps the app's own queue changes from being reported back to it. */
    private val echo = QueueEcho()

    override fun load() {
        val token = SessionToken(context, ComponentName(context, EmberPlaybackService::class.java))
        val future = MediaController.Builder(context, token).setListener(sessionEvents).buildAsync()
        // On the main thread, like every read of `controller` and `pending`.
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            pending.forEach { it(c) }; pending.clear()
            tick()
        }, main::post)
    }

    /** Plugin methods run on Capacitor's own thread. Checking `controller`
     *  there raced the connection landing on the main thread: a call queued
     *  just after `pending` was drained (the startup setQueue, getState) was
     *  never run and its promise never settled. Deciding on the main thread
     *  keeps the two in order. */
    private fun withController(fn: (MediaController) -> Unit) {
        main.post {
            val c = controller
            if (c != null) fn(c) else pending.add(fn)
        }
    }

    private fun items(c: MediaController): List<MediaItem> = (0 until c.mediaItemCount).map { c.getMediaItemAt(it) }

    private fun state(c: MediaController): JSObject = JSObject().apply {
        put("playing", c.isPlaying || (c.playWhenReady && c.playbackState == Player.STATE_BUFFERING))
        put("position", c.currentPosition / 1000.0)
        put("duration", if (c.duration > 0) c.duration / 1000.0 else 0.0)
        put("index", if (c.mediaItemCount == 0) -1 else c.currentMediaItemIndex)
        put("trackId", c.currentMediaItem?.mediaId)
        put("shuffle", c.shuffleModeEnabled)
        put("repeat", c.repeatMode)
        put("loop", LoopModes.fromRepeat(c.repeatMode))
        cacheState(c.sessionExtras).let { (ids, stalled, offline) ->
            put("cachedIds", JSArray(ids))
            put("offlineStalled", stalled)
            put("offline", offline)
        }
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            controller?.let { notifyListeners("state", state(it)) }
            if (events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) && player.playbackState == Player.STATE_ENDED) {
                notifyListeners("ended", JSObject())
            }
            if (events.contains(Player.EVENT_PLAYER_ERROR)) {
                notifyListeners("error", JSObject().put("message", player.playerError?.message ?: "playback error"))
            }
        }
        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            if (reason != Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) return
            val c = controller ?: return
            val items = items(c)
            if (!echo.isNews(items.map { it.mediaId })) return
            notifyListeners("queue", queueJs(items, c.currentMediaItemIndex))
        }
    }

    /** The service tells us when a prank sound has ended, and publishes the
     *  auto cache state (which queued songs are on the phone, offline stall)
     *  as session extras. */
    private val sessionEvents = object : MediaController.Listener {
        override fun onExtrasChanged(controller: MediaController, extras: Bundle) {
            notifyListeners("state", state(controller))
        }

        override fun onCustomCommand(controller: MediaController, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            if (command.customAction != OverlayEvents.COMMAND_ENDED) return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            notifyListeners("overlay", OverlayEvents.endedJs(args))
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    /** ~4 Hz position while playing; the web slider expects that cadence. */
    private fun tick() {
        val c = controller ?: return
        if (c.isPlaying) notifyListeners("state", state(c))
        main.postDelayed({ tick() }, 250)
    }

    @PluginMethod fun setQueue(call: PluginCall) {
        val tracks = call.getArray("tracks") ?: JSArray()
        val index = call.getInt("index") ?: 0
        val play = call.getBoolean("play") ?: true
        val items = (0 until tracks.length()).map { TrackItems.toMediaItem(tracks.getJSONObject(it), ServerConfig.baseUrl(context)) }
        // Optional (newer web builds): where the queue came from, so the
        // native prefetch window wraps loop-all where the web player does.
        val queueContext = queueContextArgs(call.data)
        withController { c ->
            echo.sent(items.map { it.mediaId })
            // Sent first: the service applies it before the items arrive.
            c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_QUEUE_CONTEXT, Bundle.EMPTY), queueContext)
            // Never restarts the song that plays when it is still the one asked for.
            echo.applying = true
            try { QueueSync.apply(c, items, index) } finally { echo.applying = false }
            if (play) c.play()
            call.resolve()
        }
    }
    @PluginMethod fun play(call: PluginCall) = withController { it.play(); call.resolve() }
    @PluginMethod fun pause(call: PluginCall) = withController { it.pause(); call.resolve() }
    @PluginMethod fun next(call: PluginCall) = withController { it.seekToNextMediaItem(); call.resolve() }
    @PluginMethod fun prev(call: PluginCall) = withController { previous(it); call.resolve() }
    @PluginMethod fun seek(call: PluginCall) = withController { it.seekTo(((call.getDouble("sec") ?: 0.0) * 1000).toLong()); call.resolve() }
    @PluginMethod fun setVolume(call: PluginCall) = withController { it.volume = (call.getDouble("v") ?: 1.0).toFloat().coerceIn(0f, 1f); call.resolve() }
    /** Volume normalization on or off (the web app's setting). Native
     *  applies each song's gain itself as it moves between songs. */
    @PluginMethod fun setNormalize(call: PluginCall) {
        val args = Bundle().apply { putBoolean("enabled", call.getBoolean("enabled") ?: true) }
        withController { c ->
            c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_NORMALIZE, Bundle.EMPTY), args)
            call.resolve()
        }
    }
    /** The loop button: "off", "all" or "one". Native repeats by itself, so
     *  loop-one and loop-all only work once it has been told. */
    @PluginMethod fun setRepeat(call: PluginCall) {
        val mode = LoopModes.toRepeat(call.getString("mode")) ?: return call.reject("mode must be off, all or one")
        withController { it.repeatMode = mode; call.resolve() }
    }
    @PluginMethod fun getState(call: PluginCall) = withController { call.resolve(state(it)) }
    /** `{ index, tracks }`: what native is playing from. A page that starts
     *  while the music already plays (reopened after the car, or after the
     *  app was swiped away) takes this instead of pushing its saved queue
     *  over it. */
    @PluginMethod fun getQueue(call: PluginCall) = withController { c ->
        val items = items(c)
        echo.sent(items.map { it.mediaId })
        call.resolve(queueJs(items, c.currentMediaItemIndex))
    }

    /** A prank sound over the music. Resolves `{ started, reason? }` once it
     *  is actually heard (or never will be); its end arrives as the `overlay`
     *  event `{ id, phase: 'ended', reason, playedSec }`. `volume` is a share
     *  of the music's own level, `duckTo` the music's multiplier meanwhile. */
    @PluginMethod fun playOverlay(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val args = OverlayEvents.playArgs(
            call.getString("id").orEmpty(), url,
            call.getDouble("volume") ?: 1.0, call.getDouble("duckTo") ?: 1.0, call.getDouble("maxSec"),
        )
        withController { c ->
            val f = c.sendCustomCommand(SessionCommand(OverlayEvents.COMMAND_PLAY, Bundle.EMPTY), args)
            f.addListener({
                val r = runCatching { f.get() }.getOrNull()
                call.resolve(
                    if (r?.resultCode == SessionResult.RESULT_SUCCESS) OverlayEvents.startedJs(r.extras)
                    else OverlayEvents.startedJs(OverlayEvents.started(false, "error:session")),
                )
            }, MoreExecutors.directExecutor())
        }
    }
    @PluginMethod fun stopOverlay(call: PluginCall) = withController {
        it.sendCustomCommand(SessionCommand(OverlayEvents.COMMAND_STOP, Bundle.EMPTY), Bundle.EMPTY)
        call.resolve()
    }

    /** Auto cache settings, from the web app's device settings
     *  (`autoCacheEnabled`, `autoCacheOnMetered`). The service keeps them
     *  across restarts, so the car and the screen-off player follow them with
     *  the WebView gone. Resolves `{ enabled, onMetered }` as applied. */
    @PluginMethod fun setAutoCache(call: PluginCall) {
        val args = Bundle()
        call.getBoolean("enabled")?.let { args.putBoolean("enabled", it) }
        (call.getBoolean("onMetered") ?: call.getBoolean("allowMetered"))?.let { args.putBoolean("onMetered", it) }
        sendForExtras(call, EmberPlaybackService.COMMAND_AUTO_CACHE, args) { e ->
            JSObject().put("enabled", e.getBoolean("enabled")).put("onMetered", e.getBoolean("onMetered"))
        }
    }

    /** `{ bytes, count, cap }`: bytes on disk, whole songs, and the cap. */
    @PluginMethod fun cacheStats(call: PluginCall) =
        sendForExtras(call, EmberPlaybackService.COMMAND_CACHE_STATS, Bundle.EMPTY, ::statsJs)

    /** Empties the auto cache (pinned downloads are untouched); resolves the
     *  stats after. */
    @PluginMethod fun clearCache(call: PluginCall) =
        sendForExtras(call, EmberPlaybackService.COMMAND_CACHE_CLEAR, Bundle.EMPTY, ::statsJs)

    private fun statsJs(e: Bundle): JSObject =
        JSObject().put("bytes", e.getLong("bytes")).put("count", e.getInt("count")).put("cap", e.getLong("cap"))

    private fun sendForExtras(call: PluginCall, command: String, args: Bundle, map: (Bundle) -> JSObject) = withController { c ->
        val f = c.sendCustomCommand(SessionCommand(command, Bundle.EMPTY), args)
        f.addListener({
            val r = runCatching { f.get() }.getOrNull()
            if (r?.resultCode == SessionResult.RESULT_SUCCESS) call.resolve(map(r.extras)) else call.reject("$command failed")
        }, MoreExecutors.directExecutor())
    }

    override fun handleOnDestroy() {
        controller?.release(); controller = null
    }
}
