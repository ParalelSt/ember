package app.ember.music

import android.app.Activity
import android.webkit.WebView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * SafeAreaInsets.install on a real (Robolectric) WebView, on the SDK the
 * friend's Motorola runs (35, edge-to-edge enforced) and the one before it
 * (34): which insets it reads, the CSS px it publishes, that a change is
 * published again, and that it hands the insets on unconsumed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34, 35])
class SafeAreaInsetsWindowTest {
    private val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    private val web = WebView(activity)
    private val published = mutableListOf<String>()

    /** A 1080x2400 phone at 2.625x, like the emulator and most mid-range phones. */
    private val density = 2.625f

    init {
        activity.setContentView(web)
        SafeAreaInsets.install(web, { density }) { published.add(it) }
        published.clear()
    }

    private fun insets(
        statusBar: Int = 0,
        navBar: Int = 0,
        cutoutTop: Int = 0,
        ime: Int = 0,
    ): WindowInsetsCompat = WindowInsetsCompat.Builder()
        .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, statusBar, 0, 0))
        .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, navBar))
        .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.of(0, cutoutTop, 0, 0))
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, ime))
        .build()

    private fun dispatch(i: WindowInsetsCompat): WindowInsetsCompat = ViewCompat.dispatchApplyWindowInsets(web, i)

    @Test
    fun `three-button navigation reaches the page as a 48px bottom inset`() {
        // 48dp buttons and a 24dp status bar, in device pixels at 2.625x.
        dispatch(insets(statusBar = 63, navBar = 126))
        assertEquals(listOf(SafeAreaInsets.script(24, 0, 48, 0)), published)
    }

    @Test
    fun `the gesture pill reaches the page as its own smaller inset`() {
        dispatch(insets(statusBar = 63, navBar = 63))
        assertEquals(listOf(SafeAreaInsets.script(24, 0, 24, 0)), published)
    }

    @Test
    fun `a cutout deeper than the status bar wins at the top`() {
        dispatch(insets(statusBar = 63, navBar = 126, cutoutTop = 105))
        assertEquals(listOf(SafeAreaInsets.script(40, 0, 48, 0)), published)
    }

    @Test
    fun `the keyboard is not a safe-area inset`() {
        // The page handles the keyboard itself (visualViewport); lifting the
        // bars by it too would float them half way up the screen.
        dispatch(insets(statusBar = 63, navBar = 126, ime = 800))
        assertEquals(listOf(SafeAreaInsets.script(24, 0, 48, 0)), published)
    }

    @Test
    fun `switching navigation mode publishes the new inset`() {
        dispatch(insets(statusBar = 63, navBar = 126))
        dispatch(insets(statusBar = 63, navBar = 63))
        assertEquals(
            listOf(SafeAreaInsets.script(24, 0, 48, 0), SafeAreaInsets.script(24, 0, 24, 0)),
            published,
        )
    }

    @Test
    fun `a window that fits the bars publishes zeroes`() {
        // Below SDK 35 the decor lays the WebView out between the bars, so
        // the insets it is handed are empty: the page must not lift.
        dispatch(insets())
        assertEquals(listOf(SafeAreaInsets.script(0, 0, 0, 0)), published)
    }

    @Test
    fun `the insets are handed on unconsumed`() {
        val out = dispatch(insets(statusBar = 63, navBar = 126))
        assertEquals(126, out.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom)
        assertEquals(63, out.getInsets(WindowInsetsCompat.Type.statusBars()).top)
    }

    /**
     * The whole path with nothing dispatched by hand, in the shell's own
     * view tree: an AppCompat activity on the app's theme, inflating
     * Capacitor's bridge layout (a CoordinatorLayout holding the
     * CapacitorWebView), exactly what BridgeActivity shows. Install on that
     * WebView, let the window lay it out, and see what the page is sent.
     *
     * On 35 the window is edge-to-edge and nothing between the decor and the
     * WebView (AppCompat's content frame, the CoordinatorLayout) swallows the
     * dispatch, so the listener runs and publishes (Robolectric draws no
     * real bars, so the values are 0; the dispatch tests above cover the
     * numbers). On 34 the decor fits the bars and consumes them on the way
     * down, so the page is sent nothing and its CSS fallback of 0 holds,
     * which is right there because nothing is under a bar.
     */
    @Test
    fun `in the shell's own layout the insets reach the WebView on 35 and not on 34`() {
        val shell = Robolectric.buildActivity(ShellLayoutActivity::class.java).setup().get()
        val bridgeWebView = shell.findViewById<WebView>(com.getcapacitor.android.R.id.webview)
        val got = mutableListOf<String>()
        SafeAreaInsets.install(bridgeWebView, { density }) { got.add(it) }
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        if (android.os.Build.VERSION.SDK_INT >= 35) {
            assertTrue("no insets reached the WebView after install", got.isNotEmpty())
        } else {
            assertTrue(got.toString(), got.all { it == SafeAreaInsets.script(0, 0, 0, 0) })
        }
    }
}

/** BridgeActivity's view tree without the bridge: the app's theme and
 *  Capacitor's own layout. */
class ShellLayoutActivity : androidx.appcompat.app.AppCompatActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        setTheme(R.style.AppTheme_NoActionBar)
        super.onCreate(savedInstanceState)
        setContentView(com.getcapacitor.android.R.layout.capacitor_bridge_layout_main)
    }
}
