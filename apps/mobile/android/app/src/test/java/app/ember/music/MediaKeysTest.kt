package app.ember.music

import android.content.Intent
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Media keys from a headset, the steering wheel, a car over Bluetooth or a
 *  mirroring app (MediaKeys.kt), and the one-button press counting. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MediaKeysTest {
    private fun intent(code: Int, action: Int = KeyEvent.ACTION_DOWN, repeat: Int = 0) =
        Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(0, 0, action, code, repeat))

    /** A scheduler the test drives: `later` records, `advance` runs what is due. */
    private class Clock {
        var now = 0L
        private val tasks = ArrayList<Pair<Long, () -> Unit>>()
        val later: (Long, () -> Unit) -> (() -> Unit) = { ms, fn ->
            val task = (now + ms) to fn
            tasks.add(task)
            ({ tasks.remove(task); Unit })
        }
        fun advance(ms: Long) {
            now += ms
            tasks.filter { it.first <= now }.forEach { tasks.remove(it); it.second() }
        }
    }

    @Test fun `one, two and three presses are play-pause, next and previous`() {
        assertEquals(MediaKeys.Action.TOGGLE, MediaKeys.forPresses(1))
        assertEquals(MediaKeys.Action.NEXT, MediaKeys.forPresses(2))
        assertEquals(MediaKeys.Action.PREVIOUS, MediaKeys.forPresses(3))
        assertEquals(MediaKeys.Action.PREVIOUS, MediaKeys.forPresses(5))
    }

    @Test fun `every media key has its action, and STOP from the car only pauses`() {
        assertEquals(MediaKeys.Action.TOGGLE, MediaKeys.actionFor(KeyEvent.KEYCODE_HEADSETHOOK))
        assertEquals(MediaKeys.Action.TOGGLE, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertEquals(MediaKeys.Action.PLAY, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertEquals(MediaKeys.Action.PAUSE, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_PAUSE))
        assertEquals(MediaKeys.Action.PAUSE, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_STOP))
        assertEquals(MediaKeys.Action.NEXT, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertEquals(MediaKeys.Action.NEXT, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD))
        assertEquals(MediaKeys.Action.PREVIOUS, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_PREVIOUS))
        assertEquals(MediaKeys.Action.FORWARD, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
        assertEquals(MediaKeys.Action.BACK, MediaKeys.actionFor(KeyEvent.KEYCODE_MEDIA_REWIND))
        assertNull(MediaKeys.actionFor(KeyEvent.KEYCODE_VOLUME_UP))
        assertTrue(MediaKeys.counts(KeyEvent.KEYCODE_HEADSETHOOK))
        assertFalse(MediaKeys.counts(KeyEvent.KEYCODE_MEDIA_NEXT))
    }

    @Test fun `only the first press of a key counts, not its release or its repeats`() {
        assertEquals(KeyEvent.KEYCODE_MEDIA_NEXT, MediaKeys.pressOf(intent(KeyEvent.KEYCODE_MEDIA_NEXT))!!.keyCode)
        assertNull(MediaKeys.pressOf(intent(KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.ACTION_UP)))
        assertNull(MediaKeys.pressOf(intent(KeyEvent.KEYCODE_MEDIA_NEXT, repeat = 1)))
        assertNull(MediaKeys.pressOf(Intent("other")))
        assertNull(MediaKeys.pressOf(null))
    }

    @Test fun `a cold start is only made for play keys with a saved queue`() {
        assertTrue(MediaKeys.shouldStartService(KeyEvent.KEYCODE_MEDIA_PLAY, hasSavedQueue = true))
        assertTrue(MediaKeys.shouldStartService(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, hasSavedQueue = true))
        assertTrue(MediaKeys.shouldStartService(KeyEvent.KEYCODE_HEADSETHOOK, hasSavedQueue = true))
        assertFalse(MediaKeys.shouldStartService(KeyEvent.KEYCODE_MEDIA_PLAY, hasSavedQueue = false))
        assertFalse(MediaKeys.shouldStartService(KeyEvent.KEYCODE_MEDIA_NEXT, hasSavedQueue = true))
    }

    @Test fun `presses close together make one gesture once the button rests`() {
        val clock = Clock()
        val got = ArrayList<MediaKeys.Action>()
        val counter = PressCounter(later = clock.later) { got.add(it) }

        counter.press()
        clock.advance(399)
        assertEquals(emptyList<MediaKeys.Action>(), got)
        clock.advance(1)
        assertEquals(listOf(MediaKeys.Action.TOGGLE), got)

        got.clear()
        counter.press(); clock.advance(200); counter.press(); clock.advance(400)
        assertEquals(listOf(MediaKeys.Action.NEXT), got)

        got.clear()
        counter.press(); clock.advance(300); counter.press(); clock.advance(300); counter.press(); clock.advance(400)
        assertEquals(listOf(MediaKeys.Action.PREVIOUS), got)
    }

    @Test fun `presses further apart than the window are separate`() {
        val clock = Clock()
        val got = ArrayList<MediaKeys.Action>()
        val counter = PressCounter(later = clock.later) { got.add(it) }
        counter.press(); clock.advance(500); counter.press(); clock.advance(500)
        assertEquals(listOf(MediaKeys.Action.TOGGLE, MediaKeys.Action.TOGGLE), got)
    }

    @Test fun `another key settles the presses before it, in order`() {
        val clock = Clock()
        val got = ArrayList<MediaKeys.Action>()
        val counter = PressCounter(later = clock.later) { got.add(it) }
        counter.press()
        counter.flush()
        assertEquals(listOf(MediaKeys.Action.TOGGLE), got)
        clock.advance(1_000)
        assertEquals("the scheduled settle was cancelled", 1, got.size)
        counter.flush()
        assertEquals("nothing pending, nothing settled", 1, got.size)
    }
}
