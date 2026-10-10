package app.ember.music

import android.app.Activity
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The page's renderer dying (killed for memory with the screen off, or a
 *  crash) reloads the page instead of letting Android kill the app, and the
 *  music with it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RendererGoneTest {
    class Host : Activity() {
        var recreated = 0
        var closed = 0
        override fun recreate() { recreated++ }
        override fun finish() { closed++ }
    }

    private val logged = mutableListOf<String>()
    private val sink: (org.json.JSONObject) -> Boolean = { logged.add(it.getString("message")); true }

    @Before fun setUp() { RendererGone.reset(); NativeLog.reset(); NativeLog.attach(sink) }
    @After fun tearDown() { RendererGone.reset(); NativeLog.reset() }

    private fun hostWithPage(): Pair<Host, WebView> {
        val host = Robolectric.buildActivity(Host::class.java).setup().get()
        val frame = FrameLayout(host)
        val web = WebView(host)
        frame.addView(web)
        host.setContentView(frame)
        return host to web
    }

    @Test fun `the death is handled, the dead page leaves the screen and the activity reloads`() {
        val (host, web) = hostWithPage()
        assertTrue(RendererGone.handle(host, web, crashed = false, now = 1_000_000))
        assertNull("a dead WebView left on screen draws black", web.parent)
        assertEquals(1, host.recreated)
        assertEquals(0, host.closed)
        assertEquals(listOf("page renderer killed"), logged)
    }

    @Test fun `a second death straight after a reload closes instead of looping`() {
        val (host, web) = hostWithPage()
        RendererGone.handle(host, web, crashed = true, now = 1_000_000)
        val (again, web2) = hostWithPage()
        assertTrue(RendererGone.handle(again, web2, crashed = true, now = 1_000_000 + RendererGone.LOOP_WINDOW_MS - 1))
        assertEquals(0, again.recreated)
        assertEquals(1, again.closed)
        assertEquals(listOf("page renderer crashed", "page renderer crashed"), logged)
    }

    @Test fun `a death long after the last reload reloads again`() {
        assertEquals(RendererGone.Action.RELOAD, RendererGone.decide(0))
        assertEquals(RendererGone.Action.CLOSE, RendererGone.decide(10_000))
        assertEquals(RendererGone.Action.RELOAD, RendererGone.decide(RendererGone.LOOP_WINDOW_MS + 1))
    }

    @Test fun `no page at all is still handled`() {
        val (host, _) = hostWithPage()
        assertTrue(RendererGone.handle(host, null, crashed = false, now = 5))
        assertEquals(1, host.recreated)
    }
}
