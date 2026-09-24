package app.ember.music

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The bridge between Android's window insets and the web app's
 * `--ember-inset-*` CSS custom properties.
 *
 * Why this exists: the app targets SDK 35, where Android draws the status
 * bar and the navigation bar (three buttons or the gesture pill) OVER the
 * window, so the WebView fills the whole screen and anything at the bottom
 * of the page sits under the system buttons. The WebView does not turn that
 * into `env(safe-area-inset-*)` (Chromium only feeds display cutouts into
 * those on the WebView versions phones run today), so for the navigation
 * bar the page reads 0.
 *
 * So MainActivity reads the real insets off the window and publishes them
 * here as CSS custom properties on `<html>`. `--safe-top` / `--safe-bottom`
 * in globals.css are `max(env(...), var(--ember-inset-*, 0px))`, so whichever
 * of the two is real wins and both being absent still resolves to 0.
 *
 * Below SDK 35 the decor fits the system windows: the WebView is laid out
 * between the bars and the insets it is handed are 0, which is correct
 * there, so nothing about those phones moves.
 *
 * The script is pure string work so the JVM tests can pin it exactly
 * (SafeAreaInsetsTest); [install] is the one piece that needs a view, and
 * Robolectric drives it on SDK 34 and 35 (SafeAreaInsetsWindowTest).
 */
object SafeAreaInsets {
    /** The four properties, in the order the script writes them. */
    @JvmField
    val PROPERTIES = arrayOf("--ember-inset-top", "--ember-inset-right", "--ember-inset-bottom", "--ember-inset-left")

    /** What stands between the page and the screen edge: the status bar, the
     *  navigation bar (buttons or pill) and a display cutout. */
    @JvmStatic
    fun types(): Int = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()

    /**
     * A device-pixel inset as the CSS pixels the page lays out in. The
     * WebView's CSS pixel is one density-independent pixel, so this is the
     * same conversion as px -> dp. Negative or nonsense input is 0: an inset
     * that cannot be trusted must not move the layout.
     */
    @JvmStatic
    fun cssPx(px: Int, density: Float): Int {
        if (px <= 0 || density <= 0f || density.isNaN()) return 0
        return Math.round(px / density)
    }

    /** The window's insets as `[top, right, bottom, left]` CSS px. */
    @JvmStatic
    fun cssInsets(windowInsets: WindowInsetsCompat, density: Float): IntArray {
        val i = windowInsets.getInsets(types())
        return intArrayOf(cssPx(i.top, density), cssPx(i.right, density), cssPx(i.bottom, density), cssPx(i.left, density))
    }

    /**
     * Listen for the view's window insets and hand [publish] the script for
     * every set that arrives: the first layout, a switch between gesture and
     * three-button navigation, the bar hiding or showing.
     *
     * The insets are passed on to the view's own handler and returned
     * unconsumed: the WebView's own handler is what lets a newer WebView
     * fill env(safe-area-inset-*) itself (the CSS takes the larger, so the
     * two never add up), and consuming them would hide them from anything
     * Capacitor or a plugin adds to the view.
     */
    @JvmStatic
    fun install(view: View, density: () -> Float, publish: (String) -> Unit) {
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, windowInsets ->
            val css = cssInsets(windowInsets, density())
            publish(script(css[0], css[1], css[2], css[3]))
            ViewCompat.onApplyWindowInsets(v, windowInsets)
        }
        ViewCompat.requestApplyInsets(view)
    }

    /**
     * The script that publishes one set of insets.
     *
     * It runs three ways: against the page that is open when the insets
     * arrive, as a document-start script on every page loaded afterwards,
     * and again at the end of every page load (MainActivity), so it has to
     * be idempotent. At document start `document.documentElement` can still
     * be null, hence the retry on readystatechange.
     *
     * The values live on `window.__emberInsets` and a MutationObserver puts
     * them back whenever `<html>`'s style attribute loses them: the
     * properties are inline style on the root element, and anything that
     * rewrites that attribute (React re-creating the root's attributes after
     * a failed hydration, a theme write) would otherwise drop them for good,
     * because the native side only sends them again when the insets change.
     */
    @JvmStatic
    fun script(top: Int, right: Int, bottom: Int, left: Int): String {
        val values = intArrayOf(top, right, bottom, left)
        val pairs = StringBuilder()
        for (i in PROPERTIES.indices) {
            if (i > 0) pairs.append(',')
            pairs.append('\'').append(PROPERTIES[i]).append("':'").append(values[i]).append("px'")
        }
        return "(function(){var w=window;w.__emberInsets={$pairs};" +
            "function a(){var e=document.documentElement;if(!e)return false;var v=w.__emberInsets;" +
            "for(var k in v)if(e.style.getPropertyValue(k)!==v[k])e.style.setProperty(k,v[k]);" +
            "if(!w.__emberInsetsWatch&&w.MutationObserver){w.__emberInsetsWatch=new MutationObserver(a);" +
            "w.__emberInsetsWatch.observe(e,{attributes:true,attributeFilter:['style']});}" +
            "return true;}" +
            "if(!a())document.addEventListener('readystatechange',a);})();"
    }
}
