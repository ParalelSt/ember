package app.ember.music

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONArray
import org.json.JSONObject

/** The web UI's handle on the native player. Commands in, state out.
 *
 *  Everything goes through a Media3 MediaController, the same door the car
 *  uses, so there is exactly one way to drive the player. */
@CapacitorPlugin(name = "EmberPlayer")
class EmberPlayerPlugin : Plugin() {
    private var controller: MediaController? = null
    private val main = Handler(Looper.getMainLooper())
    private val pending = ArrayList<(MediaController) -> Unit>()
    /** Set while a queue change came from JS, so the resulting timeline event
     *  is not reported back as "the native side built a queue". */
    private var queueFromJs = 0L

    override fun load() {
        val token = SessionToken(context, ComponentName(context, EmberPlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            pending.forEach { it(c) }; pending.clear()
            tick()
        }, MoreExecutors.directExecutor())
    }

    private fun withController(fn: (MediaController) -> Unit) {
        val c = controller
        if (c != null) main.post { fn(c) } else pending.add(fn)
    }

    private fun state(c: MediaController): JSObject = JSObject().apply {
        put("playing", c.isPlaying || (c.playWhenReady && c.playbackState == Player.STATE_BUFFERING))
        put("position", c.currentPosition / 1000.0)
        put("duration", if (c.duration > 0) c.duration / 1000.0 else 0.0)
        put("index", if (c.mediaItemCount == 0) -1 else c.currentMediaItemIndex)
        put("trackId", c.currentMediaItem?.mediaId)
        put("shuffle", c.shuffleModeEnabled)
        put("repeat", c.repeatMode)
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
            if (System.currentTimeMillis() - queueFromJs < 1500) return
            val c = controller ?: return
            val items = (0 until c.mediaItemCount).map { c.getMediaItemAt(it) }
            notifyListeners("queue", JSObject().apply {
                put("index", c.currentMediaItemIndex)
                put("tracks", JSArray(TrackItems.toJson(items).toString()))
            })
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
        withController { c ->
            queueFromJs = System.currentTimeMillis()
            val current = (0 until c.mediaItemCount).map { c.getMediaItemAt(it).mediaId }
            val wanted = items.map { it.mediaId }
            val sameStart = wanted.size >= current.size && current.isNotEmpty() && wanted.subList(0, current.size) == current
            when {
                // Same queue, maybe a different item: never restart what plays.
                wanted == current -> if (index != c.currentMediaItemIndex) c.seekTo(index, 0)
                // Radio / add-to-queue appended: keep playing, add the tail.
                sameStart && index == c.currentMediaItemIndex -> c.addMediaItems(items.subList(current.size, items.size))
                else -> { c.setMediaItems(items, index, 0); c.prepare() }
            }
            if (play) c.play()
            call.resolve()
        }
    }
    @PluginMethod fun play(call: PluginCall) = withController { it.play(); call.resolve() }
    @PluginMethod fun pause(call: PluginCall) = withController { it.pause(); call.resolve() }
    @PluginMethod fun next(call: PluginCall) = withController { it.seekToNextMediaItem(); call.resolve() }
    @PluginMethod fun prev(call: PluginCall) = withController { it.seekToPreviousMediaItem(); call.resolve() }
    @PluginMethod fun seek(call: PluginCall) = withController { it.seekTo(((call.getDouble("sec") ?: 0.0) * 1000).toLong()); call.resolve() }
    @PluginMethod fun setVolume(call: PluginCall) = withController { it.volume = (call.getDouble("v") ?: 1.0).toFloat().coerceIn(0f, 1f); call.resolve() }
    @PluginMethod fun getState(call: PluginCall) = withController { call.resolve(state(it)) }

    override fun handleOnDestroy() {
        controller?.release(); controller = null
    }
}
