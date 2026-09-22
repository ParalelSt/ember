package app.ember.music

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The event order the web's capacitor adapter relies on. */
class SpeechSessionTest {
    private val events = mutableListOf<Pair<String, Map<String, Any?>>>()
    private val session = SpeechSession { e, p -> events += e to p }
    private fun names() = events.map { it.first }

    @Test
    fun `partial then results gives partial, final, end in order`() {
        session.start()
        session.partial(listOf("daft"))
        session.partial(listOf("daft punk"))
        session.results(listOf("daft punk around the world"))
        assertEquals(listOf("partial", "partial", "final", "end"), names())
        assertEquals(mapOf("text" to "daft punk"), events[1].second)
        assertEquals(mapOf("text" to "daft punk around the world"), events[2].second)
        assertEquals(emptyMap<String, Any?>(), events[3].second)
        assertFalse(session.active)
    }

    @Test
    fun `blank partials are not sent`() {
        session.start()
        session.partial(listOf(" "))
        session.partial(emptyList())
        assertEquals(emptyList<String>(), names())
    }

    @Test
    fun `NO_MATCH after a partial promotes it to the final text`() {
        session.start()
        session.partial(listOf("around the world"))
        session.error(SpeechRecognizer.ERROR_NO_MATCH)
        assertEquals(listOf("partial", "final", "end"), names())
        assertEquals(mapOf("text" to "around the world"), events[1].second)
    }

    @Test
    fun `SPEECH_TIMEOUT after a partial also promotes it`() {
        session.start()
        session.partial(listOf("hello"))
        session.error(SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
        assertEquals(listOf("partial", "final", "end"), names())
    }

    @Test
    fun `an error before any partial gives error then end`() {
        session.start()
        session.error(SpeechRecognizer.ERROR_NETWORK)
        assertEquals(listOf("error", "end"), names())
        assertEquals(mapOf("kind" to "network", "detail" to "code ${SpeechRecognizer.ERROR_NETWORK}"), events[0].second)
    }

    @Test
    fun `silence with no partial is a quiet no-speech error`() {
        session.start()
        session.error(SpeechRecognizer.ERROR_NO_MATCH)
        assertEquals(listOf("error", "end"), names())
        assertEquals("no-speech", events[0].second["kind"])
    }

    @Test
    fun `a non-silence error after a partial is still an error`() {
        session.start()
        session.partial(listOf("hi"))
        session.error(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
        assertEquals(listOf("partial", "error", "end"), names())
        assertEquals("permission-denied", events[1].second["kind"])
    }

    @Test
    fun `empty results fall back to the last partial, or no-speech`() {
        session.start()
        session.partial(listOf("last words"))
        session.results(emptyList())
        assertEquals(mapOf("text" to "last words"), events[1].second)

        events.clear()
        session.start()
        session.results(listOf(""))
        assertEquals(listOf("error", "end"), names())
        assertEquals("no-speech", events[0].second["kind"])
    }

    @Test
    fun `end is sent once and everything after it is ignored`() {
        session.start()
        session.results(listOf("one"))
        session.results(listOf("two"))
        session.partial(listOf("three"))
        session.error(SpeechRecognizer.ERROR_NETWORK)
        session.ended()
        session.abort()
        assertEquals(listOf("final", "end"), names())
    }

    @Test
    fun `abort emits only end`() {
        session.start()
        assertTrue(session.active)
        session.abort()
        assertEquals(listOf("end"), names())
        assertFalse(session.active)
    }

    @Test
    fun `ended without a result still ends once`() {
        session.start()
        session.ended()
        session.ended()
        assertEquals(listOf("end"), names())
    }

    @Test
    fun `nothing is emitted before start`() {
        session.partial(listOf("x"))
        session.results(listOf("x"))
        session.abort()
        assertEquals(emptyList<String>(), names())
    }

    @Test
    fun `a new start begins a fresh session`() {
        session.start()
        session.partial(listOf("old"))
        session.abort()
        events.clear()
        session.start()
        session.error(SpeechRecognizer.ERROR_NO_MATCH)
        // The old partial must not leak into the new session's final.
        assertEquals(listOf("error", "end"), names())
    }
}
