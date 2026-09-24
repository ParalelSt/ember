package app.ember.music

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.getcapacitor.JSObject
import kotlin.math.abs
import kotlin.math.roundToLong

/** The pure parts of a prank sound: where it may come from, how long it may
 *  last, how loud it and the music are. Unit tested (PrankOverlayTest). */
object OverlayMix {
    /** Hard cap on a sound, whatever the file's length or the caller asks. */
    const val MAX_SEC = 30.0
    /** A sound that has not started by then is given up on. */
    const val START_TIMEOUT_MS = 8_000L

    fun clamp01(v: Double): Double = if (v.isNaN()) 0.0 else v.coerceIn(0.0, 1.0)

    fun capMs(maxSec: Double?): Long {
        val sec = if (maxSec == null || maxSec.isNaN() || maxSec <= 0) MAX_SEC else minOf(maxSec, MAX_SEC)
        return (sec * 1000).roundToLong()
    }

    /** Seconds actually heard, to one decimal, never past the cap. */
    fun playedSec(positionMs: Long, capMs: Long): Double =
        (positionMs.coerceIn(0L, capMs) / 100.0).roundToLong() / 10.0

    /** Only the Ember server: the data source attaches the sign-in cookie to
     *  every request, so a foreign URL would carry it away. */
    fun resolveUrl(url: String, baseUrl: String): String? = when {
        url.startsWith("/") && !url.startsWith("//") -> baseUrl + url
        url.startsWith("$baseUrl/") -> url
        else -> null
    }
}

/** The music's level while a sound plays. `base` is the person's own level;
 *  the music plays at base * factor. A level set from outside while ducked
 *  (the volume slider) becomes the new base and is ducked in turn. */
class OverlayDuck(factor: Double) {
    val factor: Float = OverlayMix.clamp01(factor).toFloat()
    var base: Float = 1f
        private set
    private var applied: Float = 1f

    /** Level to give the music now. */
    fun start(current: Float): Float {
        base = current
        applied = current * factor
        return applied
    }

    /** The music's level changed: null when it is our own write echoing back,
     *  else the ducked level to apply instead. */
    fun onVolumeChanged(v: Float): Float? {
        if (abs(v - applied) < 1e-4f) return null
        base = v
        applied = v * factor
        return applied
    }

    /** The sound's level: the admin's share of what the person hears. */
    fun overlayVolume(share: Double): Float = OverlayMix.clamp01(share).toFloat() * base
}

/** Service <-> plugin wire format. Reasons match the web overlay's
 *  (`ended`, `stopped`, `cap`, `error`) so the receiver acks the same way. */
object OverlayEvents {
    const val COMMAND_PLAY = "ember.overlay.play"
    const val COMMAND_STOP = "ember.overlay.stop"
    const val COMMAND_ENDED = "ember.overlay.ended"

    fun playArgs(id: String, url: String, volume: Double, duckTo: Double, maxSec: Double?): Bundle = Bundle().apply {
        putString("id", id)
        putString("url", url)
        putDouble("volume", volume)
        putDouble("duckTo", duckTo)
        if (maxSec != null) putDouble("maxSec", maxSec)
    }

    fun started(ok: Boolean, reason: String? = null): Bundle = Bundle().apply {
        putBoolean("started", ok)
        if (reason != null) putString("reason", reason)
    }

    fun ended(id: String, reason: String, playedSec: Double): Bundle = Bundle().apply {
        putString("id", id)
        putString("reason", reason)
        putDouble("playedSec", playedSec)
    }

    fun startedJs(b: Bundle?): JSObject = JSObject().apply {
        put("started", b?.getBoolean("started", false) ?: false)
        b?.getString("reason")?.let { put("reason", it) }
    }

    fun endedJs(b: Bundle): JSObject = JSObject().apply {
        put("id", b.getString("id").orEmpty())
        put("phase", "ended")
        put("reason", b.getString("reason") ?: "error")
        put("playedSec", b.getDouble("playedSec", 0.0))
    }
}

/** A prank sound over the music: a second ExoPlayer that never takes audio
 *  focus (so the music keeps playing), the music ducked while it plays and
 *  restored after, 30 s at most. Writes nothing anywhere: no history, likes
 *  or queue. Main thread only. */
class PrankOverlay(
    private val context: Context,
    private val music: Player,
    private val dataSource: OkHttpDataSource.Factory,
    private val baseUrl: String,
) {
    /** One sound in flight. */
    private inner class Run(
        val id: String,
        val share: Double,
        val duck: OverlayDuck,
        val capMs: Long,
        val onStarted: (Bundle) -> Unit,
        val onEnded: (Bundle) -> Unit,
    ) {
        var started = false
    }

    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var run: Run? = null

    private val soundListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val r = run ?: return
            if (!isPlaying || r.started) return
            r.started = true
            main.removeCallbacks(startTimeout)
            // The cap runs from the first sound, whatever the file's length.
            main.postDelayed(capReached, r.capMs)
            music.volume = r.duck.start(music.volume)
            player?.volume = r.duck.overlayVolume(r.share)
            r.onStarted(OverlayEvents.started(true))
        }
        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_ENDED) finish("ended")
        }
        override fun onPlayerError(error: PlaybackException) = finish("error")
    }

    private val musicListener = object : Player.Listener {
        // Pausing the music (or a call taking it over) ends the sound.
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady) finish("stopped")
        }
        override fun onPlaybackSuppressionReasonChanged(reason: Int) {
            if (reason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) finish("stopped")
        }
        override fun onVolumeChanged(volume: Float) {
            val r = run?.takeIf { it.started } ?: return
            r.duck.onVolumeChanged(volume)?.let { music.volume = it }
            player?.volume = r.duck.overlayVolume(r.share)
        }
    }

    private val startTimeout = Runnable { finish("error") }
    private val capReached = Runnable { finish("cap") }

    init {
        music.addListener(musicListener)
    }

    private fun sound(): ExoPlayer = player ?: ExoPlayer.Builder(context)
        .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(dataSource))
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SONIFICATION).build(), false)
        .build()
        .also { it.addListener(soundListener); player = it }

    fun play(id: String, url: String, share: Double, duckTo: Double, maxSec: Double?, onStarted: (Bundle) -> Unit, onEnded: (Bundle) -> Unit) {
        finish("stopped")
        val resolved = OverlayMix.resolveUrl(url, baseUrl)
        if (resolved == null) {
            onStarted(OverlayEvents.started(false, "error:url"))
            return
        }
        if (!music.playWhenReady) {
            onStarted(OverlayEvents.started(false, "not-playing"))
            return
        }
        val r = Run(id, share, OverlayDuck(duckTo), OverlayMix.capMs(maxSec), onStarted, onEnded)
        run = r
        main.postDelayed(startTimeout, OverlayMix.START_TIMEOUT_MS)
        sound().apply {
            volume = OverlayMix.clamp01(share).toFloat() * music.volume
            setMediaItem(MediaItem.fromUri(resolved))
            prepare()
            play()
        }
    }

    fun stop() = finish("stopped")

    private fun finish(reason: String) {
        val r = run ?: return
        run = null
        main.removeCallbacks(startTimeout)
        main.removeCallbacks(capReached)
        val played = player?.let { OverlayMix.playedSec(it.currentPosition, r.capMs) } ?: 0.0
        player?.run { stop(); clearMediaItems() }
        if (r.started) {
            music.volume = r.duck.base
            r.onEnded(OverlayEvents.ended(r.id, reason, played))
        } else {
            r.onStarted(OverlayEvents.started(false, if (reason == "stopped") "stopped" else "error:load"))
        }
    }

    fun release() {
        finish("stopped")
        music.removeListener(musicListener)
        player?.release()
        player = null
    }
}
