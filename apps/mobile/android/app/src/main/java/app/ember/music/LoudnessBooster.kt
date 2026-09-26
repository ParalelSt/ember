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
 *  less than full volume. */
class LoudnessBooster(private val player: ExoPlayer) : Booster, Player.Listener {
    private var fx: LoudnessEnhancer? = null
    private var targetMb = 0

    init {
        player.addListener(this)
    }

    override fun setBoost(linear: Float) {
        val mb = millibels(linear)
        if (mb == targetMb) return
        targetMb = mb
        push()
    }

    override fun onAudioSessionIdChanged(audioSessionId: Int) {
        // A new session: the old effect is on audio nobody plays any more.
        drop()
        push()
    }

    private fun push() {
        if (targetMb <= 0) {
            fx?.let { runCatching { it.enabled = false } }
            return
        }
        val e = fx ?: open() ?: return
        runCatching {
            e.setTargetGain(targetMb)
            e.enabled = true
        }.onFailure { Log.w(EmberPlaybackService.TAG, "loudness boost: ${it.message}") }
    }

    private fun open(): LoudnessEnhancer? {
        val id = player.audioSessionId
        if (id == C.AUDIO_SESSION_ID_UNSET || id == 0) return null
        return runCatching { LoudnessEnhancer(id) }
            .onFailure { Log.w(EmberPlaybackService.TAG, "no loudness enhancer: ${it.message}") }
            .getOrNull()
            ?.also { fx = it }
    }

    private fun drop() {
        fx?.let { runCatching { it.release() } }
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
