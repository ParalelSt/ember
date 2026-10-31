package app.ember.music

import app.ember.music.PresenceThrottle.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same coalescing as discord.rs: newest wins, seeks are not dropped. */
class PresenceThrottleTest {
    private val t = PresenceThrottle()

    private fun song(title: String, position: Double, at: Long) =
        PresenceCard(title, "X", null, null, position, 240.0, at)

    @Test fun `the first card goes at once`() {
        val c = song("A", 0.0, 1_000_000)
        assertEquals(Decision.Send(c), t.offer(c, 1_000_000))
    }

    @Test fun `a song change always goes through, and drops a waiting seek`() {
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        t.offer(song("A", 60.0, 1_001_000), 1_001_000)
        val b = song("B", 0.0, 1_002_000)
        assertEquals(Decision.Send(b), t.offer(b, 1_002_000))
        assertNull(t.pending)
    }

    @Test fun `seeks inside the window wait, and the newest wins with its own moment`() {
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        assertEquals(Decision.Wait(14_000), t.offer(song("A", 30.0, 1_001_000), 1_001_000))
        val last = song("A", 90.0, 1_002_000)
        assertEquals(Decision.Wait(13_000), t.offer(last, 1_002_000))
        assertEquals(Decision.Send(last), t.flush(1_015_000))
        assertEquals(Decision.Nothing, t.flush(1_016_000))
    }

    @Test fun `a seek after the window goes at once`() {
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        val c = song("A", 100.0, 1_016_000)
        assertEquals(Decision.Send(c), t.offer(c, 1_016_000))
    }

    @Test fun `a seek queued after a song change waits out the new song's window`() {
        // A seek in A queued a flush for 0:15. B went out at 0:10 and a seek
        // in B at 0:12 queued behind A's timer: at 0:15 it must wait to 0:25.
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        t.offer(song("A", 30.0, 1_001_000), 1_001_000)
        t.offer(song("B", 0.0, 1_010_000), 1_010_000)
        val seek = song("B", 50.0, 1_012_000)
        t.offer(seek, 1_012_000)
        assertEquals(Decision.Wait(10_000), t.flush(1_015_000))
        assertEquals(Decision.Send(seek), t.flush(1_025_000))
    }

    @Test fun `nothing playing clears at once, drops a waiting seek, and a resume is news`() {
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        t.offer(song("A", 30.0, 1_001_000), 1_001_000)
        assertEquals(Decision.Clear, t.offer(null, 1_002_000))
        assertNull(t.pending)
        assertEquals(Decision.Nothing, t.flush(1_020_000))
        val resume = song("A", 30.0, 1_003_000)
        assertEquals(Decision.Send(resume), t.offer(resume, 1_003_000))
    }

    @Test fun `there is nothing to clear when nothing was shown`() {
        assertEquals(Decision.Nothing, t.offer(null, 1_000_000))
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        t.offer(null, 1_001_000)
        assertEquals(Decision.Nothing, t.offer(null, 1_002_000))
    }

    @Test fun `the same card again sends nothing, later or not`() {
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        // Buffering and ready, the playhead right where the clock says.
        assertEquals(Decision.Nothing, t.offer(song("A", 5.0, 1_005_000), 1_005_000))
        assertEquals(Decision.Nothing, t.offer(song("A", 100.0, 1_100_000), 1_100_000))
    }

    @Test fun `a seek away and back drops the seek that waited`() {
        t.offer(song("A", 0.0, 1_000_000), 1_000_000)
        t.offer(song("A", 90.0, 1_001_000), 1_001_000)
        assertEquals(Decision.Nothing, t.offer(song("A", 2.0, 1_002_000), 1_002_000))
        assertNull(t.pending)
    }

    @Test fun `a length learned later corrects the card`() {
        t.offer(PresenceCard("A", "X", null, null, 0.0, 0.0, 1_000_000), 1_000_000)
        assertTrue(t.offer(song("A", 1.0, 1_001_000), 1_001_000) is Decision.Wait)
    }

    @Test fun `a card Discord did not take is not the same card, and the window still counts`() {
        val c = song("A", 0.0, 1_000_000)
        t.offer(c, 1_000_000)
        t.failed()
        assertTrue(t.offer(song("A", 1.0, 1_001_000), 1_001_000) is Decision.Wait)
        val later = song("A", 30.0, 1_030_000)
        assertEquals(Decision.Send(later), t.offer(later, 1_030_000))
    }
}
