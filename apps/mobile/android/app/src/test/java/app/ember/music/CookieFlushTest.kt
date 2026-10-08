package app.ember.music

import androidx.activity.ComponentActivity
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * A fresh sign-in survives the app being killed (2026-10-07, the car's ANR):
 * Chromium writes the WebView's cookies to disk lazily, about 30 s after a
 * change, so a process that died sooner came back signed out. The cookie
 * store is flushed when the page reports a session change, on every page
 * load, and whenever the activity is paused or stopped.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CookieFlushTest {
    private var flushes = 0

    @Before fun setUp() {
        flushes = 0
        CookieFlush.flusher = { flushes++ }
    }

    @After fun tearDown() = CookieFlush.resetForTests()

    @Test fun `pausing and stopping the activity each flush the cookies`() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        CookieFlush.install(controller.get())
        assertEquals(0, flushes)
        controller.pause()
        assertEquals(1, flushes)
        controller.stop()
        assertEquals(2, flushes)
    }

    @Test fun `the page's session change flushes through the EmberApp plugin`() {
        var resolved = false
        val call = object : PluginCall(null, "EmberApp", "cb", "flushCookies", JSObject()) {
            override fun resolve() { resolved = true }
            override fun resolve(data: JSObject?) { resolved = true }
        }
        EmberAppPlugin().flushCookies(call)
        assertEquals(1, flushes)
        assertTrue(resolved)
        val method = EmberAppPlugin::class.java.getMethod("flushCookies", PluginCall::class.java)
        assertTrue(method.isAnnotationPresent(PluginMethod::class.java))
    }

    @Test fun `a cookie store that throws never takes the app down`() {
        CookieFlush.flusher = { throw IllegalStateException("no WebView provider") }
        assertFalse(CookieFlush.now())
    }

    @Test fun `the activity installs it and flushes on every page load`() {
        val activity = File("src/main/java/app/ember/music/MainActivity.java").readText()
        assertTrue(activity.contains("CookieFlush.INSTANCE.install(this)"))
        assertTrue(activity.contains("CookieFlush.INSTANCE.now()"))
    }
}
