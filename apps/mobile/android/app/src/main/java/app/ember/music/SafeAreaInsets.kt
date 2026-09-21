package app.ember.music

/**
 * The bridge between Android's window insets and the web app's
 * `--ember-inset-*` CSS custom properties.
 *
 * Why this exists: the app targets SDK 35, where Android draws the status
 * bar and the three-button navigation bar OVER the window, so the WebView
 * fills the whole screen and Ember's bottom nav sits under the back, home
 * and recents buttons. The WebView does not turn that into
 * `env(safe-area-inset-*)` — Chromium only feeds display cutouts into those,
 * and for the navigation bar the page reads 0, so the `0px` fallback in
 * globals.css wins and nothing lifts.
 *
 * So MainActivity reads the real insets off the window and publishes them
 * here as CSS custom properties on `<html>`. `--safe-top` / `--safe-bottom`
 * in globals.css are `max(env(...), var(--ember-inset-*, 0px))`, so whichever
 * of the two is real wins and both being absent still resolves to 0.
 *
 * Everything in this file is pure string work on purpose: it is what the
 * JVM unit tests can actually assert (SafeAreaInsetsTest), and it keeps the
 * one piece that needs a live window down to a few lines in MainActivity.
 */
object SafeAreaInsets {
    /** The four properties, in the order the script writes them. */
    @JvmField
    val PROPERTIES = arrayOf("--ember-inset-top", "--ember-inset-right", "--ember-inset-bottom", "--ember-inset-left")

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

    /**
     * The script that publishes one set of insets. Self-contained and
     * idempotent, because it runs both against the page that is open now
     * and, registered as a document-start script, against every page loaded
     * afterwards. At document start `document.documentElement` can still be
     * null, hence the retry on readystatechange.
     */
    @JvmStatic
    fun script(top: Int, right: Int, bottom: Int, left: Int): String {
        val values = intArrayOf(top, right, bottom, left)
        val pairs = StringBuilder()
        for (i in PROPERTIES.indices) {
            if (i > 0) pairs.append(',')
            pairs.append('\'').append(PROPERTIES[i]).append("':'").append(values[i]).append("px'")
        }
        return "(function(){var v={$pairs};" +
            "function a(){var e=document.documentElement;if(!e)return false;" +
            "for(var k in v)e.style.setProperty(k,v[k]);return true;}" +
            "if(!a())document.addEventListener('readystatechange',a);})();"
    }
}
