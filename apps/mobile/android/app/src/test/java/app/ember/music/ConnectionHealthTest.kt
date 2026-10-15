package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A network Android calls online can carry nothing (a weak mobile signal).
 * A hint asks the server; no answer is "down" until an answer or data comes.
 * Plain JVM: the clock, the timers and the threads are the test's.
 */
class ConnectionHealthTest {
    private var now = 1_000_000L
    private val answers = ArrayDeque<Boolean>()
    private var probes = 0
    private val timers = ArrayList<Pair<Long, Runnable>>()
    private val changes = ArrayList<Boolean>()
    /** Set to hold the probe's answer back, as a slow network would. */
    private var held: Runnable? = null
    private var hold = false

    private val health = ConnectionHealth(
        probe = { probes++; answers.removeFirstOrNull() ?: false },
        io = { if (hold) held = it else it.run() },
        main = { it.run() },
        later = { ms, task ->
            val t = (now + ms) to task
            timers.add(t)
            ({ timers.remove(t) })
        },
        clock = { now },
        onChange = { changes.add(it) },
    )

    /** Moves the clock on, running the timers that come due. */
    private fun advance(ms: Long) {
        now += ms
        while (true) {
            val due = timers.filter { it.first <= now }.minByOrNull { it.first } ?: return
            timers.remove(due)
            due.second.run()
        }
    }

    @Test fun `no answer is down, and it asks again until one comes`() {
        answers.addAll(listOf(false, false, true))
        health.suspect()
        assertTrue(health.down)
        assertEquals(listOf(true), changes)
        advance(ConnectionHealth.RETRY_MS)
        assertTrue(health.down)
        assertEquals(2, probes)
        advance(ConnectionHealth.RETRY_MS)
        assertFalse(health.down)
        assertEquals(listOf(true, false), changes)
        advance(10 * ConnectionHealth.RETRY_MS)
        assertEquals("no asking once it is up", 3, probes)
    }

    @Test fun `an answer is up, and a hint right after it asks nothing`() {
        answers.add(true)
        health.suspect()
        assertFalse(health.down)
        assertEquals(emptyList<Boolean>(), changes)
        advance(ConnectionHealth.FRESH_MS - 1)
        health.suspect()
        assertEquals(1, probes)
        advance(1)
        health.suspect()
        assertEquals(2, probes)
    }

    @Test fun `data coming in ends it at once, without waiting for the next look`() {
        health.suspect()
        assertTrue(health.down)
        health.onData()
        assertFalse(health.down)
        assertEquals(listOf(true, false), changes)
        advance(10 * ConnectionHealth.RETRY_MS)
        assertEquals("the retry was cancelled", 1, probes)
    }

    @Test fun `data that came in recently makes a hint ask nothing`() {
        health.onData()
        health.suspect()
        assertEquals(0, probes)
        assertFalse(health.down)
    }

    @Test fun `data that came in while the server was being asked counts as an answer`() {
        hold = true
        health.suspect()
        now += 1
        health.onData()
        held!!.run()
        assertFalse(health.down)
        assertEquals(emptyList<Boolean>(), changes)
    }

    @Test fun `one look at a time`() {
        hold = true
        health.suspect()
        val first = held
        advance(ConnectionHealth.FRESH_MS)
        health.suspect()
        assertTrue("no second look started", held === first)
        first!!.run()
        assertEquals(1, probes)
    }

    @Test fun `another network while down looks again now`() {
        answers.addAll(listOf(false, true))
        health.suspect()
        assertTrue(health.down)
        health.onNetworkChanged()
        assertFalse(health.down)
        assertEquals(2, probes)
        advance(10 * ConnectionHealth.RETRY_MS)
        assertEquals(2, probes)
    }

    @Test fun `another network while up asks nothing`() {
        health.onNetworkChanged()
        assertEquals(0, probes)
    }

    @Test fun `stopped, it asks no more`() {
        health.suspect()
        health.stop()
        advance(10 * ConnectionHealth.RETRY_MS)
        health.suspect()
        assertEquals(1, probes)
    }

    @Test fun `a probe that throws is no answer`() {
        val h = ConnectionHealth({ throw java.io.IOException("x") }, { it.run() }, { it.run() }, { _, _ -> {} }, { now }) { changes.add(it) }
        h.suspect()
        assertTrue(h.down)
    }
}
