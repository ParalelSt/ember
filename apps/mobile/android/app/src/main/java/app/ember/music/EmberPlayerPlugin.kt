package app.ember.music

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ContextThemeWrapper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import androidx.mediarouter.app.MediaRouteChooserDialog
import androidx.mediarouter.app.MediaRouteControllerDialog
import androidx.mediarouter.app.SystemOutputSwitcherDialogController
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastState
import com.google.android.gms.cast.framework.CastStateListener
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

/** `{ index, tracks, shuffle }`: the native queue as the web app holds it,
 *  and whether it is shuffled (the car's Shuffle button reorders it). Both
 *  the `queue` event and getQueue send this. */
internal fun queueJs(items: List<MediaItem>, index: Int, shuffle: Boolean = false): JSObject = JSObject().apply {
    put("index", if (items.isEmpty()) -1 else index)
    put("tracks", JSArray(TrackItems.toJson(items).toString()))
    put("shuffle", shuffle)
}

/** Whether native's queue is shuffled: the service's session extra, or,
 *  from an older service without one, the player's flag. */
internal fun shuffleOf(extras: Bundle, playerFlag: Boolean): Boolean =
    if (extras.containsKey(EmberPlaybackService.EXTRA_SHUFFLE)) extras.getBoolean(EmberPlaybackService.EXTRA_SHUFFLE) else playerFlag

/** setShuffle's args for the service: `on`, `order` (the song ids from
 *  before shuffling) when the app sent one, and `restore` (off: native puts
 *  the order back, for a page that never had it). */
internal fun shuffleArgs(data: JSONObject): Bundle = Bundle().apply {
    putBoolean("on", data.optBoolean("on", false))
    putBoolean("restore", data.optBoolean("restore", false))
    data.optJSONArray("order")?.let { arr ->
        putStringArrayList("order", ArrayList((0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }))
    }
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

/** `{ available, connecting, connected, deviceName }`, the web app's Cast
 *  button state (lib/cast/controller), from the Cast framework's state. */
internal fun castStateJs(state: Int, deviceName: String?): JSObject = JSObject().apply {
    put("available", state != CastState.NO_DEVICES_AVAILABLE)
    put("connecting", state == CastState.CONNECTING)
    put("connected", state == CastState.CONNECTED)
    put("deviceName", if (state == CastState.CONNECTED) deviceName else null)
}

/** Whether the volume slider's [v] goes to the cast device. Only a change
 *  does: the page sends its level again when it starts (a WebView brought
 *  back mid-cast) and that must not reset a volume set on the TV itself.
 *  [last] is the level last received, null for none yet. */
internal fun castVolumeToSend(last: Double?, v: Double): Boolean = last != null && last != v

/** getOutputs' answer and the `outputs` event: `{ outputs: [{ id, name,
 *  kind }], currentId, preferredId, systemSwitcher }`. Ids are strings (the
 *  web app keeps them opaque); a missing current or pinned output is null,
 *  not an absent key. */
internal fun outputsJs(s: OutputSnapshot): JSObject = JSObject().apply {
    val list = JSArray()
    s.outputs.forEach { o -> list.put(JSObject().put("id", o.id.toString()).put("name", o.name).put("kind", o.kind)) }
    put("outputs", list)
    put("currentId", s.currentId?.toString() ?: JSONObject.NULL)
    put("preferredId", s.preferredId?.toString() ?: JSONObject.NULL)
    put("systemSwitcher", s.systemSwitcher)
}

/** The pinned output from the service's session extras: an id, or null for
 *  automatic (-1, or a service that has published none yet). */
internal fun pinnedOutput(extras: Bundle): Int? =
    extras.getInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED, -1).takeIf { it >= 0 }

/** setOutput's `id`: null (or missing) is automatic; a string or number is
 *  a device id; anything else is no output at all (Result failure). */
internal fun outputIdArg(data: JSONObject): Result<Int?> {
    val raw = data.opt("id")
    if (raw == null || raw == JSONObject.NULL) return Result.success(null)
    val id = raw.toString().toIntOrNull()?.takeIf { it >= 0 } ?: return Result.failure(IllegalArgumentException("no such output"))
    return Result.success(id)
}

/** showOutputSwitcher's answer: `{ shown: true }` for Android's own output
 *  switcher, `{ shown: true, fallback: "bluetooth-settings" }` when only the
 *  Bluetooth settings could open, `{ shown: false }` when nothing did. */
internal fun switcherJs(shown: Boolean, fallbackOpened: Boolean): JSObject = when {
    shown -> JSObject().put("shown", true)
    fallbackOpened -> JSObject().put("shown", true).put("fallback", "bluetooth-settings")
    else -> JSObject().put("shown", false)
}

/** getCastDevices' answer and the `castDevices` event: `{ devices: [{ id,
 *  name, description, selected, connecting }] }`. */
internal fun castDevicesJs(devices: List<CastDevice>): JSObject = JSObject().apply {
    val list = JSArray()
    devices.forEach { d ->
        list.put(JSObject().apply {
            put("id", d.id)
            put("name", d.name)
            put("description", d.description ?: JSONObject.NULL)
            put("selected", d.selected)
            put("connecting", d.connecting)
        })
    }
    put("devices", list)
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
        main.post { startCast() }
        val token = SessionToken(context, ComponentName(context, EmberPlaybackService::class.java))
        val future = MediaController.Builder(context, token).setListener(sessionEvents).buildAsync()
        // On the main thread, like every read of `controller` and `pending`.
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            pending.forEach { it(c) }; pending.clear()
            // The service may have kept a pin from before this page (a
            // WebView brought back while the music played).
            pinned = pinnedOutput(c.sessionExtras)
            emitOutputs()
            tick()
        }, main::post)
        main.post { watchOutputs(true) }
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
        put("shuffle", shuffleOf(c.sessionExtras, c.shuffleModeEnabled))
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
            notifyListeners("queue", queueJs(items, c.currentMediaItemIndex, shuffleOf(c.sessionExtras, c.shuffleModeEnabled)))
        }
    }

    /** The service tells us when a prank sound has ended, and publishes the
     *  auto cache state (which queued songs are on the phone, offline stall)
     *  as session extras. */
    private val sessionEvents = object : MediaController.Listener {
        override fun onExtrasChanged(controller: MediaController, extras: Bundle) {
            notifyListeners("state", state(controller))
            pinned = pinnedOutput(extras)
            emitOutputs()
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
        // Optional (newer web builds): where the song starts, in seconds.
        val startMs = ((call.getDouble("startSec") ?: 0.0).coerceAtLeast(0.0) * 1000).toLong()
        val art = ArtworkUris.authority(context.packageName)
        val items = (0 until tracks.length()).map { TrackItems.toMediaItem(tracks.getJSONObject(it), ServerConfig.baseUrl(context), art) }
        // Optional (newer web builds): where the queue came from, so the
        // native prefetch window wraps loop-all where the web player does.
        val queueContext = queueContextArgs(call.data)
        withController { c ->
            echo.sent(items.map { it.mediaId })
            // Sent first: the service applies it before the items arrive.
            c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_QUEUE_CONTEXT, Bundle.EMPTY), queueContext)
            // Never restarts the song that plays when it is still the one asked for.
            echo.applying = true
            try { QueueSync.apply(c, items, index, startMs) } finally { echo.applying = false }
            if (play) c.play()
            call.resolve()
        }
    }
    @PluginMethod fun play(call: PluginCall) = withController { it.play(); call.resolve() }
    @PluginMethod fun pause(call: PluginCall) = withController { it.pause(); call.resolve() }
    @PluginMethod fun next(call: PluginCall) = withController { it.seekToNextMediaItem(); call.resolve() }
    @PluginMethod fun prev(call: PluginCall) = withController { previous(it); call.resolve() }
    @PluginMethod fun seek(call: PluginCall) = withController { it.seekTo(((call.getDouble("sec") ?: 0.0) * 1000).toLong()); call.resolve() }
    /** The volume slider. While casting it sets the TV's (or speaker's) own
     *  volume, like the volume keys do. */
    private var lastVolume: Double? = null

    @PluginMethod fun setVolume(call: PluginCall) {
        val v = (call.getDouble("v") ?: 1.0).coerceIn(0.0, 1.0)
        main.post {
            val cast = castContext?.sessionManager?.currentCastSession?.takeIf { it.isConnected }
            val send = castVolumeToSend(lastVolume, v)
            lastVolume = v
            if (cast != null) {
                if (send) runCatching { cast.volume = v }.onFailure { android.util.Log.w(EmberPlaybackService.TAG, "cast volume: ${it.message}") }
                call.resolve()
            } else {
                withController { it.volume = v.toFloat(); call.resolve() }
            }
        }
    }
    /** Volume normalization on or off (the web app's setting). Native
     *  applies each song's gain itself as it moves between songs. */
    @PluginMethod fun setNormalize(call: PluginCall) {
        val args = Bundle().apply { putBoolean("enabled", call.getBoolean("enabled") ?: true) }
        withController { c ->
            c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_NORMALIZE, Bundle.EMPTY), args)
            call.resolve()
        }
    }
    /** The equalizer (the web app's setting): `enabled` and `bands`, five
     *  gains in dB for 60 Hz, 230 Hz, 910 Hz, 3.6 kHz and 14 kHz. The service
     *  keeps it on disk and filters every song itself (Equalizer.kt). */
    @PluginMethod fun setEqualizer(call: PluginCall) {
        val arr = call.getArray("bands")
        val bands = arr?.let { a -> (0 until a.length()).map { a.optDouble(it) } }
        val args = EqSettings.toBundle(EqSettings.of(call.getBoolean("enabled") ?: false, bands))
        withController { c ->
            c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_EQUALIZER, Bundle.EMPTY), args)
            call.resolve()
        }
    }
    /** The loop button: "off", "all" or "one". Native repeats by itself, so
     *  loop-one and loop-all only work once it has been told. */
    @PluginMethod fun setRepeat(call: PluginCall) {
        val mode = LoopModes.toRepeat(call.getString("mode")) ?: return call.reject("mode must be off, all or one")
        withController { it.repeatMode = mode; call.resolve() }
    }
    /** The app's shuffle button: `on`, and `order` (the song ids before it
     *  shuffled). The app reorders its queue itself and sends it with
     *  setQueue; this keeps native's flag (the car's button shows it) and
     *  the way back for when the car turns shuffle off. */
    @PluginMethod fun setShuffle(call: PluginCall) {
        val args = shuffleArgs(call.data)
        withController { c ->
            c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_SHUFFLE_STATE, Bundle.EMPTY), args)
            call.resolve()
        }
    }
    @PluginMethod fun getState(call: PluginCall) = withController { call.resolve(state(it)) }
    /** `{ index, tracks }`: what native is playing from. A page that starts
     *  while the music already plays (reopened after the car, or after the
     *  app was swiped away) takes this instead of pushing its saved queue
     *  over it. */
    @PluginMethod fun getQueue(call: PluginCall) = withController { c ->
        val items = items(c)
        echo.sent(items.map { it.mediaId })
        call.resolve(queueJs(items, c.currentMediaItemIndex, shuffleOf(c.sessionExtras, c.shuffleModeEnabled)))
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

    // ── Casting ─────────────────────────────────────────────────────────
    // The player service does the casting itself (CastSwitch); the app only
    // needs the Cast button: whether a device is around, what is connected,
    // and the picker.

    private var castContext: CastContext? = null
    private val castListener = CastStateListener {
        notifyListeners("cast", castJs())
        emitCastDevices()
    }
    /** Looking for devices costs battery: only while the app is on screen.
     *  Every route change is news to the in-app picker: a cast device found
     *  or lost (`castDevices`), and, as the phone's own routes (Bluetooth,
     *  the speaker) come in unfiltered, a change of output (`outputs`). */
    private val routeCallback = object : MediaRouter.Callback() {
        override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) = routesChanged()
        override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) = routesChanged()
        override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = routesChanged()
        override fun onRouteSelected(router: MediaRouter, selectedRoute: MediaRouter.RouteInfo, reason: Int, requestedRoute: MediaRouter.RouteInfo) = routesChanged()
        override fun onRouteUnselected(router: MediaRouter, route: MediaRouter.RouteInfo, reason: Int) = routesChanged()
    }
    private var discovering = false

    private fun routesChanged() {
        emitCastDevices()
        emitOutputs()
    }

    private fun startCast() {
        // The Task-based getSharedInstance needs an executor and a callback for
        // what is, on the main thread, an immediate answer.
        @Suppress("DEPRECATION")
        val ctx = runCatching { CastContext.getSharedInstance(context) }.getOrNull() ?: return
        castContext = ctx
        ctx.addCastStateListener(castListener)
        discover(true)
        notifyListeners("cast", castJs())
    }

    private fun discover(on: Boolean) {
        val selector = castContext?.mergedSelector ?: return
        val router = runCatching { MediaRouter.getInstance(context) }.getOrNull() ?: return
        if (on && !discovering) {
            router.addCallback(selector, routeCallback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY or MediaRouter.CALLBACK_FLAG_UNFILTERED_EVENTS)
        }
        if (!on && discovering) router.removeCallback(routeCallback)
        discovering = on
    }

    private fun castJs(): JSObject {
        val ctx = castContext ?: return castStateJs(CastState.NO_DEVICES_AVAILABLE, null)
        return castStateJs(ctx.castState, ctx.sessionManager.currentCastSession?.castDevice?.friendlyName)
    }

    /** `{ available, connecting, connected, deviceName }`. Nothing is
     *  available on a phone without Google Play services. */
    @PluginMethod fun getCastState(call: PluginCall) {
        main.post { call.resolve(castJs()) }
    }

    /** The Cast device picker, or, while casting, the device's controls
     *  (its volume, and Stop casting). */
    @PluginMethod fun showCastPicker(call: PluginCall) {
        main.post {
            val ctx = castContext ?: return@post call.reject("Casting is not available on this phone")
            val act = activity ?: return@post call.reject("the app is not on screen")
            // The app's own theme clears view backgrounds for the WebView;
            // the dialogs get a plain one.
            val themed = ContextThemeWrapper(act, androidx.appcompat.R.style.Theme_AppCompat_DayNight)
            runCatching {
                if (ctx.sessionManager.currentCastSession?.isConnected == true) {
                    MediaRouteControllerDialog(themed).show()
                } else {
                    MediaRouteChooserDialog(themed).apply { routeSelector = ctx.mergedSelector ?: MediaRouteSelector.EMPTY }.show()
                }
            }.onFailure { return@post call.reject("could not open the cast picker: ${it.message}") }
            call.resolve()
        }
    }

    // ── In-app cast device list ─────────────────────────────────────────
    // The Spotify-style picker lists cast devices next to the phone's own
    // outputs, from the routes the discovery above finds. Picking one does
    // what the Cast dialog does (route.select()): the Cast framework starts
    // the session and the service moves the queue over (CastSwitch).

    private var lastCastDevices: String? = null

    /** The router's routes with what the picker needs of each. Empty on a
     *  phone without Cast. */
    private fun castRoutes(): List<Pair<MediaRouter.RouteInfo, CastRoute>> {
        val selector = castContext?.mergedSelector ?: return emptyList()
        val router = runCatching { MediaRouter.getInstance(context) }.getOrNull() ?: return emptyList()
        return runCatching {
            router.routes.map { r ->
                r to CastRoute(
                    id = r.id, name = r.name, description = r.description,
                    enabled = r.isEnabled, isDefault = r.isDefault, isBluetooth = r.isBluetooth, isSystem = r.isSystemRoute,
                    matchesSelector = r.matchesSelector(selector), selected = r.isSelected, connectionState = r.connectionState,
                )
            }
        }.onFailure { android.util.Log.w(EmberPlaybackService.TAG, "cast routes: ${it.message}") }.getOrDefault(emptyList())
    }

    private fun castDevices(): List<CastDevice> = CastDevices.list(castRoutes().map { it.second })

    /** The `castDevices` event, only when the list is not what was last sent. */
    private fun emitCastDevices() {
        val js = castDevicesJs(castDevices())
        val text = js.toString()
        if (text == lastCastDevices) return
        lastCastDevices = text
        notifyListeners("castDevices", js)
    }

    /** `{ devices: [{ id, name, description, selected, connecting }] }`:
     *  the cast devices found while the app is on screen. */
    @PluginMethod fun getCastDevices(call: PluginCall) {
        main.post { call.resolve(castDevicesJs(castDevices())) }
    }

    /** Casts to the device with `id` (from getCastDevices). */
    @PluginMethod fun selectCastDevice(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("no such cast device")
        main.post {
            if (castContext == null) return@post call.reject("Casting is not available on this phone")
            val routes = castRoutes()
            val listed = CastDevices.list(routes.map { it.second }).map { it.id }.toSet()
            val route = routes.firstOrNull { it.second.id == id && id in listed }?.first
                ?: return@post call.reject("no such cast device")
            runCatching { route.select() }.onFailure { return@post call.reject("could not cast: ${it.message}") }
            call.resolve()
        }
    }

    /** Ends the cast session; the music comes back to the phone (CastSwitch). */
    @PluginMethod fun stopCasting(call: PluginCall) {
        main.post {
            runCatching { castContext?.sessionManager?.endCurrentSession(true) }
                .onFailure { android.util.Log.w(EmberPlaybackService.TAG, "stop casting: ${it.message}") }
            call.resolve()
        }
    }

    // ── Audio output ────────────────────────────────────────────────────
    // The phone's own outputs (speaker, wired, Bluetooth, USB, HDMI) for the
    // app's device picker. The list is read here; the choice is kept by the
    // service, which owns the player (COMMAND_OUTPUT, OutputPreference), and
    // comes back through its session extras.

    /** The output the service has pinned, null for automatic. */
    private var pinned: Int? = null
    private var lastOutputs: String? = null
    private val audio: AudioManager? get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager?
    private val mediaAttributes by lazy {
        android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
    }

    /** Headphones plugged in, a headset connected or gone: a new list. */
    private val deviceWatch = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = emitOutputs()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = emitOutputs()
    }

    private fun watchOutputs(on: Boolean) {
        runCatching {
            if (on) audio?.registerAudioDeviceCallback(deviceWatch, main) else audio?.unregisterAudioDeviceCallback(deviceWatch)
        }.onFailure { android.util.Log.w(EmberPlaybackService.TAG, "output watch: ${it.message}") }
    }

    /** What AudioManager reports now, as the picker shows it. Nothing
     *  here may take the app down on an odd phone: a call that fails reads
     *  as nothing known. */
    private fun outputSnapshot(): OutputSnapshot {
        val am = audio
        val sdk = Build.VERSION.SDK_INT
        val devices = runCatching {
            am?.getDevices(AudioManager.GET_DEVICES_OUTPUTS)?.map {
                OutputInfo(it.id, it.type, it.productName?.toString(), if (sdk >= 28) it.address else null, it.isSink)
            }
        }.onFailure { android.util.Log.w(EmberPlaybackService.TAG, "outputs: ${it.message}") }.getOrNull().orEmpty()
        // Android says where media goes from 13 (API 33); below, a guess.
        val routed = if (sdk >= 33) runCatching {
            am?.getAudioDevicesForAttributes(mediaAttributes)?.map { RoutedOutput(it.id, it.type, it.address) }
        }.getOrNull() else null
        return AudioOutputs.snapshot(devices, pinned, routed, sdk, Build.MODEL)
    }

    /** The `outputs` event, only when it differs from the last one sent. */
    private fun emitOutputs() {
        val js = outputsJs(outputSnapshot())
        val text = js.toString()
        if (text == lastOutputs) return
        lastOutputs = text
        notifyListeners("outputs", js)
    }

    /** `{ outputs: [{ id, name, kind }], currentId, preferredId,
     *  systemSwitcher }`. While casting, still the phone's own outputs: the
     *  app shows the cast device apart. */
    @PluginMethod fun getOutputs(call: PluginCall) {
        main.post { call.resolve(outputsJs(outputSnapshot())) }
    }

    /** Plays on the output with `id` (from getOutputs), or, for null, where
     *  Android would (automatic). Resolves the new getOutputs answer. */
    @PluginMethod fun setOutput(call: PluginCall) {
        val id = outputIdArg(call.data).getOrElse { return call.reject("no such output") }
        main.post {
            if (id != null && outputSnapshot().outputs.none { it.id == id }) return@post call.reject("no such output")
            withController { c ->
                val args = Bundle().apply { putInt("deviceId", id ?: -1) }
                val f = c.sendCustomCommand(SessionCommand(EmberPlaybackService.COMMAND_OUTPUT, Bundle.EMPTY), args)
                f.addListener({
                    val r = runCatching { f.get() }.getOrNull()
                    when (r?.resultCode) {
                        SessionResult.RESULT_SUCCESS -> {
                            // The answer carries the pin; the session extras
                            // saying the same may not have landed yet.
                            pinned = pinnedOutput(r.extras)
                            call.resolve(outputsJs(outputSnapshot()))
                            emitOutputs()
                        }
                        SessionResult.RESULT_ERROR_BAD_VALUE -> call.reject("no such output")
                        else -> call.reject("could not switch the output")
                    }
                }, main::post)
            }
        }
    }

    /** Android's own output switcher (the media output dialog, which also
     *  lists cast devices), on Android 11 and up. Where there is none, the
     *  Bluetooth settings instead. */
    @PluginMethod fun showOutputSwitcher(call: PluginCall) {
        main.post {
            val ctx = activity ?: context
            val shown = runCatching { SystemOutputSwitcherDialogController.showDialog(ctx) }
                .onFailure { android.util.Log.w(EmberPlaybackService.TAG, "output switcher: ${it.message}") }
                .getOrDefault(false)
            val fallback = !shown && runCatching {
                ctx.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.isSuccess
            call.resolve(switcherJs(shown, fallback))
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        main.post {
            discover(true)
            // Back on screen after a trip to the settings or the switcher.
            emitOutputs()
            emitCastDevices()
        }
    }

    override fun handleOnPause() {
        super.handleOnPause()
        main.post { discover(false) }
    }

    override fun handleOnDestroy() {
        controller?.release(); controller = null
        main.post {
            discover(false)
            castContext?.removeCastStateListener(castListener)
            watchOutputs(false)
        }
    }
}
