package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The px -> CSS px conversion and the script MainActivity injects, which is
 * everything about the safe-area fix that does not need a live window.
 */
class SafeAreaInsetsTest {
    @Test
    fun `converts device pixels to css pixels at the display density`() {
        // A 48dp navigation bar on a 3x phone is 144px, and has to reach the
        // page as 48 CSS px.
        assertEquals(48, SafeAreaInsets.cssPx(144, 3f))
        assertEquals(48, SafeAreaInsets.cssPx(96, 2f))
        assertEquals(48, SafeAreaInsets.cssPx(48, 1f))
        // 2.75x (a 1080x2400 phone): 132px rounds back to 48.
        assertEquals(48, SafeAreaInsets.cssPx(132, 2.75f))
    }

    @Test
    fun `refuses to move the layout on an inset it cannot trust`() {
        assertEquals(0, SafeAreaInsets.cssPx(0, 3f))
        assertEquals(0, SafeAreaInsets.cssPx(-10, 3f))
        assertEquals(0, SafeAreaInsets.cssPx(144, 0f))
        assertEquals(0, SafeAreaInsets.cssPx(144, Float.NaN))
    }

    @Test
    fun `publishes all four insets as css custom properties in px`() {
        val js = SafeAreaInsets.script(24, 0, 48, 0)
        assertTrue(js, js.contains("'--ember-inset-top':'24px'"))
        assertTrue(js, js.contains("'--ember-inset-right':'0px'"))
        assertTrue(js, js.contains("'--ember-inset-bottom':'48px'"))
        assertTrue(js, js.contains("'--ember-inset-left':'0px'"))
        // The names have to be exactly the ones globals.css reads.
        assertEquals(
            listOf("--ember-inset-top", "--ember-inset-right", "--ember-inset-bottom", "--ember-inset-left"),
            SafeAreaInsets.PROPERTIES.toList(),
        )
    }

    @Test
    fun `writes the properties onto the document element and retries if it is not there yet`() {
        val js = SafeAreaInsets.script(0, 0, 48, 0)
        assertTrue(js, js.contains("document.documentElement"))
        assertTrue(js, js.contains("setProperty"))
        // Registered as a document-start script, it can run before <html>
        // exists, so it must have a second chance at it.
        assertTrue(js, js.contains("readystatechange"))
        // Self-contained: it leaks no globals into the page.
        assertTrue(js, js.startsWith("(function(){"))
    }

    @Test
    fun `the same insets produce the same script, so republishing is a no-op`() {
        assertEquals(SafeAreaInsets.script(24, 0, 48, 0), SafeAreaInsets.script(24, 0, 48, 0))
        assertNotEquals(SafeAreaInsets.script(24, 0, 48, 0), SafeAreaInsets.script(24, 0, 0, 0))
    }

    /**
     * The exact script a 48dp navigation bar produces. The browser half of
     * this fix, tests/mobile-player-ui.test.mjs, runs this same literal in a
     * real Chromium tab and asserts the bar and the bottom nav lift by 48px,
     * so the two ends of the contract are pinned to one string.
     */
    @Test
    fun `the 48dp navigation bar script is exactly what the browser test runs`() {
        assertEquals(
            "(function(){var v={'--ember-inset-top':'0px','--ember-inset-right':'0px'," +
                "'--ember-inset-bottom':'48px','--ember-inset-left':'0px'};" +
                "function a(){var e=document.documentElement;if(!e)return false;" +
                "for(var k in v)e.style.setProperty(k,v[k]);return true;}" +
                "if(!a())document.addEventListener('readystatechange',a);})();",
            SafeAreaInsets.script(0, 0, 48, 0),
        )
    }

    @Test
    fun `a window with no insets publishes zeroes rather than nothing`() {
        // The keyboard closing, or a phone rotating out of a cutout, has to
        // put the page back rather than leave the last lift in place.
        val js = SafeAreaInsets.script(0, 0, 0, 0)
        assertTrue(js, js.contains("'--ember-inset-bottom':'0px'"))
    }
}
