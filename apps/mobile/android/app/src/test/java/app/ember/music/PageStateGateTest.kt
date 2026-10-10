package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the page hears of the player while the app is off screen
 *  (EmberPlayerPlugin, bug report 2026-10-09): the screen off for a while
 *  froze the page, and the 4 Hz position tick piled up thousands of stale
 *  states that the page replayed when it came back. */
class PageStateGateTest {
    private fun key(index: Int = 0, playing: Boolean = true, loop: String = "off", shuffle: Boolean = false, offline: Boolean = false) =
        PageStateGate.key(index, "t$index", playing, loop, shuffle, offlineStalled = false, offline = offline)

    @Test fun `on screen everything goes, the tick included`() {
        val gate = PageStateGate()
        assertTrue(gate.onScreen)
        repeat(3) { assertTrue(gate.admit(key(), tick = true)) }
        assertTrue(gate.admit(key(), tick = false))
    }

    @Test fun `off screen the tick stops and only a real change goes`() {
        val gate = PageStateGate()
        gate.admit(key(0), tick = false)
        gate.hidden()
        assertFalse(gate.onScreen)
        // Ten minutes of 4 Hz ticks: none of them.
        assertEquals(0, (1..2400).count { gate.admit(key(0), tick = true) })
        // Player events that change nothing the page acts on (buffering, the
        // cache list growing): none either.
        assertFalse(gate.admit(key(0), tick = false))
        // The next song, a pause, the loop or shuffle mode, offline: each once.
        assertTrue(gate.admit(key(1), tick = false))
        assertFalse(gate.admit(key(1), tick = false))
        assertTrue(gate.admit(key(1, playing = false), tick = false))
        assertTrue(gate.admit(key(1, playing = false, loop = "all"), tick = false))
        assertTrue(gate.admit(key(1, playing = false, loop = "all", shuffle = true), tick = false))
        assertTrue(gate.admit(key(1, playing = false, loop = "all", shuffle = true, offline = true), tick = false))
        // Even a song change does not come through a tick.
        assertFalse(gate.admit(key(2), tick = true))
    }

    @Test fun `coming back says to send a fresh state once, and everything flows again`() {
        val gate = PageStateGate()
        assertFalse("already on screen: nothing to catch up", gate.shown())
        gate.hidden()
        assertTrue(gate.shown())
        assertFalse(gate.shown())
        assertTrue(gate.admit(key(0), tick = true))
        assertTrue(gate.admit(key(0), tick = true))
    }

    @Test fun `the position, length and cache list are not part of the key`() {
        assertEquals(
            PageStateGate.key(3, "a", true, "off", false, false, false),
            PageStateGate.key(3, "a", true, "off", false, false, false),
        )
        assertTrue(PageStateGate.key(3, null, true, "off", false, false, false) != PageStateGate.key(3, "a", true, "off", false, false, false))
        assertTrue(PageStateGate.key(3, "a", true, "off", false, true, false) != PageStateGate.key(3, "a", true, "off", false, false, false))
    }
}
