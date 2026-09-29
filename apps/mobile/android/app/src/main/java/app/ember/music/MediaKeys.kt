package app.ember.music

import android.content.Intent
import android.view.KeyEvent

/** Media buttons: a headset, the steering wheel, a car over Bluetooth, or a
 *  phone-mirroring app (JLink and the like send the car's buttons as media
 *  keys). Handled here rather than by Media3's defaults for two reasons:
 *
 *  - Media3 only knows the double press (next). The single-button convention
 *    is 1 press play/pause, 2 next, 3 previous.
 *  - A key that arrives while the app's process is being started for it
 *    (Android closed the app, then the car's play button) reached Media3
 *    before its notification controller was connected; Media3 then ignored
 *    it, and the service, started to the foreground for that key, played
 *    nothing and was killed for it. Handling every key here means play
 *    always resumes the saved queue (SavedQueue). */
object MediaKeys {
    enum class Action { TOGGLE, PLAY, PAUSE, NEXT, PREVIOUS, FORWARD, BACK }

    /** Presses of the one button (a headset's, or a car's play/pause) within
     *  this long of each other count as one gesture. Long enough for a
     *  deliberate triple press, short enough that play/pause still feels
     *  immediate. */
    const val MULTI_PRESS_MS = 400L

    /** The gesture [presses] presses of the one button make. */
    fun forPresses(presses: Int): Action = when {
        presses <= 1 -> Action.TOGGLE
        presses == 2 -> Action.NEXT
        else -> Action.PREVIOUS
    }

    /** Keys that are counted (one-button headsets and play/pause keys). */
    fun counts(keyCode: Int): Boolean =
        keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_HEADSETHOOK

    /** What a key does on its own; null for keys that are not media keys. */
    fun actionFor(keyCode: Int): Action? = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> Action.TOGGLE
        KeyEvent.KEYCODE_MEDIA_PLAY -> Action.PLAY
        // A car sends STOP when it switches source or turns off: pausing
        // keeps the queue and the place in the song for when it comes back.
        KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_STOP -> Action.PAUSE
        KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> Action.NEXT
        KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> Action.PREVIOUS
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> Action.FORWARD
        KeyEvent.KEYCODE_MEDIA_REWIND -> Action.BACK
        else -> null
    }

    /** The key event of a media button intent, only its first press (a held
     *  key repeats; its release is not a press). */
    @Suppress("DEPRECATION")
    fun pressOf(intent: Intent?): KeyEvent? {
        if (intent?.action != Intent.ACTION_MEDIA_BUTTON) return null
        val key = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return null
        return key.takeIf { it.action == KeyEvent.ACTION_DOWN && it.repeatCount == 0 }
    }

    /** Whether a cold start for [keyCode] can be served: only keys that start
     *  playing (Media3's receiver passes no other on Android 8+), and only
     *  with a saved queue to play. Without one the service would be started
     *  in the foreground with nothing to show, which Android punishes. */
    fun shouldStartService(keyCode: Int, hasSavedQueue: Boolean): Boolean = hasSavedQueue && (
        keyCode == KeyEvent.KEYCODE_MEDIA_PLAY || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_HEADSETHOOK
    )
}

/** Counts presses of the one button and settles on a gesture once no press
 *  has come for [windowMs]. [later] schedules on the main thread and hands
 *  back a way to cancel. */
class PressCounter(
    private val windowMs: Long = MediaKeys.MULTI_PRESS_MS,
    private val later: (Long, () -> Unit) -> (() -> Unit),
    private val onGesture: (MediaKeys.Action) -> Unit,
) {
    private var presses = 0
    private var pending: (() -> Unit)? = null

    fun press() {
        presses++
        pending?.invoke()
        pending = later(windowMs) { settle() }
    }

    /** Settles now (another key arrived: the presses so far happened first). */
    fun flush() {
        if (presses == 0) return
        pending?.invoke()
        settle()
    }

    private fun settle() {
        val n = presses
        presses = 0
        pending = null
        if (n > 0) onGesture(MediaKeys.forPresses(n))
    }
}
