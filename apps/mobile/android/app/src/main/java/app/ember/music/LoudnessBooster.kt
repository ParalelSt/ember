package app.ember.music

import android.media.audiofx.LoudnessEnhancer
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.log10
import kotlin.math.roundToInt

/** The [Booster] on the phone: Android's LoudnessEnhancer on the player's
 *  audio session, so a quiet song can come up past the player's full volume
 *  (which stops at 1). It sits in the output, like the player's volume, so a
 *  change lands on what is heard at that moment: the song change, not a
 *  buffer later.
 *
 *  Off (disabled, not just at 0) whenever there is nothing to add, so a
 *  normal song never goes through it. The server holds every boost under the
 *  song's true peak, so the enhancer's own limiter has nothing to do. A
 *  phone whose enhancer will not start just plays without the boost, at no
 *  less than full volume.
 *
 *  While casting ([setSuspended]) the phone's player is stopped and the TV
 *  plays the file as it is: the effect is let go of entirely, and made again
 *  on the player's (possibly new) audio session, at the latest boost, once
 *  the music is back on the phone.
 *
 *  [sessionId] and [openEffect] are the player's audio session and the
 *  enhancer on it; tests stand in for both. */
class LoudnessBooster(
    private val player: ExoPlayer,
    private val sessionId: () -> Int = { player.audioSessionId },
    private val openEffect: (Int) -> Effect = { EnhancerEffect(LoudnessEnhancer(it)) },
) : Booster, Player.Listener {
    /** The part of LoudnessEnhancer this uses. */
    interface Effect {
        fun setTargetGain(mb: Int)
        fun setEnabled(on: Boolean)
        fun release()
    }

    private class EnhancerEffect(private val e: LoudnessEnhancer) : Effect {
        override fun setTargetGain(mb: Int) = e.setTargetGain(mb)
        override fun setEnabled(on: Boolean) { e.enabled = on }
        override fun release() = e.release()
    }

    private var fx: Effect? = null
    private var targetMb = 0

    /** True while casting: no effect on the phone's (stopped) player. */
    var suspended = false
        private set

    /** Whether an effect is on the player's session right now. */
    val attached: Boolean get() = fx != null

    init {
        player.addListener(this)
    }

    override fun setBoost(linear: Float) {
        val mb = millibels(linear)
        if (mb == targetMb) return
        targetMb = mb
        push()
    }

    /** Casting started (true) or ended (false). The boost asked for in the
     *  meantime is kept and lands when the music comes back. */
    fun setSuspended(on: Boolean) {
        if (on == suspended) return
        suspended = on
        if (on) drop() else push()
    }

    override fun onAudioSessionIdChanged(audioSessionId: Int) {
        // A new session: the old effect is on audio nobody plays any more.
        drop()
        push()
    }

    private fun push() {
        if (suspended) return
        if (targetMb <= 0) {
            fx?.let { runCatching { it.setEnabled(false) } }
            return
        }
        val e = fx ?: open() ?: return
        runCatching {
            e.setTargetGain(targetMb)
            e.setEnabled(true)
        }.onFailure { Log.w(EmberPlaybackService.TAG, "loudness boost: ${it.message}") }
    }

    private fun open(): Effect? {
        val id = sessionId()
        if (id == C.AUDIO_SESSION_ID_UNSET || id == 0) return null
        return runCatching { openEffect(id) }
            .onFailure { Log.w(EmberPlaybackService.TAG, "no loudness enhancer: ${it.message}") }
            .getOrNull()
            ?.also { fx = it }
    }

    private fun drop() {
        fx?.let {
            runCatching { it.setEnabled(false) }
            runCatching { it.release() }
        }
        fx = null
    }

    override fun release() {
        player.removeListener(this)
        drop()
    }

    companion object {
        /** A linear multiplier as the enhancer's millibels; 0 for 1 or less. */
        fun millibels(linear: Float): Int =
            if (linear.isNaN() || linear <= 1f) 0 else (2000 * log10(linear.toDouble())).roundToInt().coerceIn(0, 600)
    }
}
