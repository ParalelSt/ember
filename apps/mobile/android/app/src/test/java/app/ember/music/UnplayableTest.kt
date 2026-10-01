package app.ember.music

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reading the host's answer for a song that will not play, and holding the
 *  notices while the app is in the background (one summary on return). */
class UnplayableTest {
    @After fun clean() = UnplayableNotices.reset()

    @Test fun `410 is gone, anything else may play later`() {
        assertEquals(Unplayable.UNAVAILABLE, Unplayable.kindOf(410))
        assertEquals(Unplayable.TRANSIENT, Unplayable.kindOf(502))
        assertEquals(Unplayable.TRANSIENT, Unplayable.kindOf(404))
        assertEquals(Unplayable.TRANSIENT, Unplayable.kindOf(null))
    }

    @Test fun `the reason comes from the host's 410 body`() {
        val body = """{"error":"[youtube] 0LYiIUMeO1o: This video is not available","unavailable":true,"reason":"unavailable"}"""
        assertEquals("unavailable", Unplayable.reasonFrom(body.toByteArray()))
        assertEquals("removed", Unplayable.reasonFrom("""{"unavailable":true, "reason" : "removed"}""".toByteArray()))
    }

    @Test fun `an unknown or missing reason is none`() {
        assertNull(Unplayable.reasonFrom("""{"reason":"weird"}""".toByteArray()))
        assertNull(Unplayable.reasonFrom("<html>".toByteArray()))
        assertNull(Unplayable.reasonFrom(ByteArray(0)))
        assertNull(Unplayable.reasonFrom(null))
    }

    @Test fun `a failure that is not an HTTP answer is transient, with no reason`() {
        val n = Unplayable.notice("youtube:a", "A", RuntimeException("no file"), Unplayable.SKIPPED)
        assertEquals(UnplayableNotice("youtube:a", "A", Unplayable.TRANSIENT, null, Unplayable.SKIPPED), n)
    }

    private fun notice(id: String, outcome: String = Unplayable.SKIPPED) =
        UnplayableNotice(id, id.uppercase(), Unplayable.UNAVAILABLE, "removed", outcome)

    @Test fun `on screen, each notice goes over as it happens`() {
        val got = ArrayList<List<UnplayableNotice>>()
        UnplayableNotices.attach { got.add(it); true }
        UnplayableNotices.setOnScreen(true)
        UnplayableNotices.record(notice("a"))
        UnplayableNotices.record(notice("b"))
        assertEquals(listOf(listOf(notice("a")), listOf(notice("b"))), got)
    }

    @Test fun `in the background they are held, and go over together on return`() {
        val got = ArrayList<List<UnplayableNotice>>()
        UnplayableNotices.attach { got.add(it); true }
        UnplayableNotices.setOnScreen(true)
        UnplayableNotices.setOnScreen(false)
        UnplayableNotices.record(notice("a"))
        UnplayableNotices.record(notice("b"))
        UnplayableNotices.record(notice("c", Unplayable.GAVE_UP))
        assertTrue(got.isEmpty())
        UnplayableNotices.setOnScreen(true)
        assertEquals(listOf(listOf(notice("a"), notice("b"), notice("c", Unplayable.GAVE_UP))), got)
        UnplayableNotices.setOnScreen(true)
        assertEquals(1, got.size)
    }

    @Test fun `a page that is not listening yet leaves them held for its first ask`() {
        UnplayableNotices.attach { false }
        UnplayableNotices.setOnScreen(true)
        UnplayableNotices.record(notice("a"))
        assertEquals(listOf(notice("a")), UnplayableNotices.drain())
        assertTrue(UnplayableNotices.drain().isEmpty())
    }

    @Test fun `with no page at all they wait, bounded`() {
        repeat(UnplayableNotices.MAX_HELD + 5) { UnplayableNotices.record(notice("s$it")) }
        val held = UnplayableNotices.drain()
        assertEquals(UnplayableNotices.MAX_HELD, held.size)
        assertEquals("s5", held.first().trackId)
    }

    @Test fun `a sink that throws keeps them for the next try`() {
        UnplayableNotices.attach { throw IllegalStateException("bridge gone") }
        UnplayableNotices.setOnScreen(true)
        UnplayableNotices.record(notice("a"))
        assertEquals(listOf(notice("a")), UnplayableNotices.drain())
    }

    @Test fun `an old plugin's detach does not drop a newer one`() {
        val got = ArrayList<List<UnplayableNotice>>()
        val old: (List<UnplayableNotice>) -> Boolean = { true }
        val new: (List<UnplayableNotice>) -> Boolean = { got.add(it); true }
        UnplayableNotices.attach(old)
        UnplayableNotices.attach(new)
        UnplayableNotices.detach(old)
        UnplayableNotices.setOnScreen(true)
        UnplayableNotices.record(notice("a"))
        assertEquals(1, got.size)
    }
}
