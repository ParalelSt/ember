package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The card's life with Discord there, missing, or switched off. Time and the
 *  SDK are fakes; nothing native runs. */
class DiscordPresenceTest {
    private class FakeEngine : DiscordEngine {
        var status: DiscordStatus = DiscordStatus.Ready
        val updates = mutableListOf<PresenceActivity>()
        var clears = 0
        var pumpOn = false
        var answer: ((Boolean, String?, Boolean) -> Unit)? = null
        var autoAnswer = true
        override fun status() = status
        override fun update(token: Long, activity: PresenceActivity, done: (Boolean, String?, Boolean) -> Unit) {
            updates.add(activity)
            answer = done
            if (autoAnswer) done(true, null, false)
        }
        override fun clear() { clears++ }
        override fun setPumping(on: Boolean) { pumpOn = on }
    }

    private class Timer(val at: Long, val task: () -> Unit) { var cancelled = false }

    private var clock = 1_000_000L
    private val timers = mutableListOf<Timer>()
    private val engine = FakeEngine()
    private val logs = mutableListOf<String>()
    private var share = true
    private var now: PresenceCard? = null

    private val presence = DiscordPresence(
        engine = engine,
        sharing = { share },
        current = { now },
        now = { clock },
        later = { ms, task ->
            val t = Timer(clock + ms, task)
            timers.add(t)
            ({ t.cancelled = true })
        },
        log = { _, m -> logs.add(m) },
    )

    private fun advance(ms: Long) {
        val end = clock + ms
        while (true) {
            val next = timers.filter { !it.cancelled && it.at <= end }.minByOrNull { it.at } ?: break
            timers.remove(next)
            clock = next.at
            next.task()
        }
        clock = end
    }

    private fun play(title: String, position: Double = 0.0) {
        now = PresenceCard(title, "X", null, null, position, 240.0, clock)
        presence.refresh()
    }

    private fun livetimers() = timers.count { !it.cancelled }

    @Test fun `a song change from the lock screen goes out straight away`() {
        play("A")
        advance(1_000)
        play("B")
        assertEquals(listOf("A", "B"), engine.updates.map { it.details.take(1) })
    }

    @Test fun `a seek inside the window lands when it ends, with the newest playhead`() {
        play("A")
        advance(1_000)
        play("A", 30.0)
        advance(1_000)
        play("A", 90.0)
        assertEquals(1, engine.updates.size)
        val start90 = clock / 1000 - 90
        advance(13_000)
        assertEquals(2, engine.updates.size)
        assertEquals(start90 * 1000, engine.updates[1].startMs)
    }

    @Test fun `a pause clears the card and throws away a waiting seek`() {
        play("A")
        play("A", 30.0)
        now = null
        presence.refresh()
        assertEquals(1, engine.clears)
        advance(60_000)
        assertEquals(1, engine.updates.size)
    }

    @Test fun `resuming puts the card back at once`() {
        play("A")
        now = null
        presence.refresh()
        play("A", 5.0)
        assertEquals(2, engine.updates.size)
    }

    @Test fun `the switch off clears a card that shows, and blocks the next`() {
        play("A")
        share = false
        presence.retryNow()
        assertEquals(1, engine.clears)
        play("B")
        assertEquals(1, engine.updates.size)
    }

    @Test fun `with the switch off the SDK is not even asked`() {
        share = false
        engine.status = DiscordStatus.Off("should not be read")
        play("A")
        assertTrue(engine.updates.isEmpty())
        assertEquals(0, engine.clears)
        assertTrue(logs.isEmpty())
    }

    @Test fun `no SDK in this build is one line and nothing more`() {
        engine.status = DiscordStatus.Off("this build has no Discord SDK")
        play("A")
        play("B")
        play("C")
        assertEquals(1, logs.size)
        assertTrue(logs[0], logs[0].contains("no Discord SDK"))
        assertTrue(engine.updates.isEmpty())
        assertEquals(0, livetimers())
    }

    @Test fun `no Discord on the phone is one line however many songs go by`() {
        engine.autoAnswer = false
        play("A")
        engine.answer!!(false, "2 not installed", false)
        play("B")
        engine.answer!!(false, "2 another text", false)
        play("C")
        engine.answer!!(false, "2 not installed", false)
        assertEquals(1, logs.size)
        assertTrue(logs[0], logs[0].contains("cannot reach"))
    }

    @Test fun `an unreachable Discord is looked for less and less, never in a loop`() {
        engine.autoAnswer = false
        play("A")
        val tries = mutableListOf(clock)
        var seen = 1
        // An hour of one long song.
        val end = clock + 60 * 60_000
        engine.answer!!(false, "no", false)
        while (clock < end) {
            advance(1_000)
            if (engine.updates.size > seen) {
                seen = engine.updates.size
                tries.add(clock)
                engine.answer!!(false, "no", false)
            }
        }
        val gaps = tries.zipWithNext { a, b -> b - a }
        assertEquals(listOf(30_000L, 60_000L, 120_000L, 240_000L, 300_000L), gaps.take(5))
        assertTrue(gaps.all { it <= PresenceBackoff.MAX_MS })
        assertTrue("tries: ${tries.size}", tries.size < 20)
        assertEquals(1, logs.size)
    }

    @Test fun `no pumping between looks`() {
        engine.autoAnswer = false
        play("A")
        assertTrue(engine.pumpOn)
        engine.answer!!(false, "no", false)
        assertFalse(engine.pumpOn)
    }

    @Test fun `Discord turning up is noticed, said once, and the backoff starts over`() {
        engine.autoAnswer = false
        play("A")
        engine.answer!!(false, "no", false)
        advance(30_000)
        engine.answer!!(false, "no", false)
        advance(60_000)
        engine.answer!!(true, null, false)
        assertEquals(listOf("cannot", "reachable"), logs.map { if ("cannot" in it) "cannot" else if ("reachable" in it) "reachable" else it })
        assertEquals(0, livetimers())
        // Down again: from the first wait, with a new line.
        play("B")
        engine.answer!!(false, "no", false)
        val before = engine.updates.size
        advance(29_000)
        assertEquals(before, engine.updates.size)
        advance(1_000)
        assertEquals(before + 1, engine.updates.size)
        assertEquals(3, logs.size)
    }

    @Test fun `Discord that never answers counts as failed, not as busy`() {
        engine.autoAnswer = false
        play("A")
        assertEquals(1, engine.updates.size)
        advance(DiscordPresence.ANSWER_TIMEOUT_MS)
        assertFalse(engine.pumpOn)
        assertEquals(1, logs.size)
        advance(PresenceBackoff.FIRST_MS)
        assertEquals(2, engine.updates.size)
    }

    @Test fun `an answer to an overtaken update is ignored`() {
        engine.autoAnswer = false
        play("A")
        val old = engine.answer!!
        play("B")
        old(false, "late", false)
        assertTrue(logs.isEmpty())
        assertTrue(engine.pumpOn)
    }

    @Test fun `pausing stops the retries`() {
        engine.autoAnswer = false
        play("A")
        engine.answer!!(false, "no", false)
        now = null
        presence.refresh()
        advance(60 * 60_000)
        assertEquals(1, engine.updates.size)
    }

    @Test fun `a library that will not load ends it, no crash and no retries`() {
        engine.autoAnswer = false
        play("A")
        engine.answer!!(false, "would not load", true)
        play("B")
        advance(60 * 60_000)
        assertEquals(1, engine.updates.size)
        assertEquals(1, logs.size)
    }

    @Test fun `waiting for the app to open is one line, then it goes when the app appears`() {
        engine.status = DiscordStatus.Waiting("waiting for Ember to open once")
        play("A")
        play("B")
        assertTrue(engine.updates.isEmpty())
        assertEquals(1, logs.size)
        engine.status = DiscordStatus.Ready
        presence.retryNow()
        assertEquals(1, engine.updates.size)
    }

    @Test fun `opening the app does not sit out the backoff`() {
        engine.autoAnswer = false
        play("A")
        engine.answer!!(false, "no", false)
        advance(20_000)
        presence.retryNow()
        assertEquals(2, engine.updates.size)
    }

    @Test fun `the service going away clears the card and leaves no timer`() {
        play("A")
        play("A", 30.0)
        presence.release()
        assertEquals(1, engine.clears)
        assertEquals(0, livetimers())
        play("B")
        assertEquals(1, engine.updates.size)
    }

    @Test fun `a clear stops the pump`() {
        play("A")
        assertTrue(engine.pumpOn)
        now = null
        presence.refresh()
        assertFalse(engine.pumpOn)
    }
}
