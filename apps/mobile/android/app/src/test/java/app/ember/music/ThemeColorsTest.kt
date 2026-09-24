package app.ember.music

import android.app.Activity
import android.graphics.drawable.ColorDrawable
import androidx.core.view.WindowInsetsControllerCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Everything about the shell following the theme that does not need a
 * phone: reading the colour, picking the bar icons, the offline page's
 * variables script, and what applyToWindow does to a window below SDK 35.
 * Robolectric for org.json and the window.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ThemeColorsTest {
    @Test
    fun `parses rrggbb into an opaque colour`() {
        assertEquals(0xFF0C0D0F.toInt(), ThemeColors.parseHex("#0c0d0f"))
        assertEquals(0xFFFFFFFF.toInt(), ThemeColors.parseHex("#FFFFFF"))
        assertEquals(0xFF000000.toInt(), ThemeColors.parseHex(" #000000 "))
    }

    @Test
    fun `refuses anything that is not rrggbb`() {
        for (bad in listOf(null, "", "#", "#fff", "0c0d0f", "#0c0d0", "#0c0d0f0", "#gg0000", "red", "oklch(0.16 0.005 260)")) {
            assertNull("$bad should not parse", ThemeColors.parseHex(bad))
        }
    }

    @Test
    fun `the default background is Ember's`() {
        assertEquals(0xFF0C0D0F.toInt(), ThemeColors.parseHex(ThemeColors.DEFAULT_BACKGROUND))
    }

    @Test
    fun `isLight is false for every shipped preset and true for a light page`() {
        // The five presets' backgrounds (lib/theme/presets.ts through oklchToHex).
        for (hex in listOf("#0c0d0f", "#080f1c", "#09120b", "#0f0a18", "#000000")) {
            assertFalse(hex, ThemeColors.isLight(ThemeColors.parseHex(hex)!!))
        }
        assertTrue(ThemeColors.isLight(ThemeColors.parseHex("#ffffff")!!))
        assertTrue(ThemeColors.isLight(ThemeColors.parseHex("#f4f1ea")!!))
    }

    @Test
    fun `isLight flips at a relative luminance of 0 point 4`() {
        // #aaaaaa is 0.402, #a9a9a9 is 0.397: either side of the line.
        assertTrue(ThemeColors.isLight(ThemeColors.parseHex("#aaaaaa")!!))
        assertFalse(ThemeColors.isLight(ThemeColors.parseHex("#a9a9a9")!!))
        assertEquals(1.0, ThemeColors.luminance(ThemeColors.parseHex("#ffffff")!!), 1e-9)
        assertEquals(0.0, ThemeColors.luminance(ThemeColors.parseHex("#000000")!!), 1e-9)
    }

    @Test
    fun `parseVars keeps theme variables and drops anything else`() {
        val vars = ThemeColors.parseVars(
            """{"--background":"oklch(0.17 0.03 262)","--border":"oklch(1 0 0 / 8%)",""" +
                """"--x":"red';alert(1)//","color":"red","--n":4,"--ember":"oklch(0.75 0.14 225)"}""",
        )
        assertEquals(
            mapOf(
                "--background" to "oklch(0.17 0.03 262)",
                "--border" to "oklch(1 0 0 / 8%)",
                "--ember" to "oklch(0.75 0.14 225)",
            ),
            vars,
        )
    }

    @Test
    fun `parseVars is empty for no or bad json`() {
        assertEquals(emptyMap<String, String>(), ThemeColors.parseVars(null))
        assertEquals(emptyMap<String, String>(), ThemeColors.parseVars(""))
        assertEquals(emptyMap<String, String>(), ThemeColors.parseVars("not json"))
        assertEquals(emptyMap<String, String>(), ThemeColors.parseVars("[1,2]"))
    }

    @Test
    fun `the script sets every variable on the document element and retries`() {
        val vars = mapOf("--background" to "oklch(0.17 0.03 262)", "--ember" to "oklch(0.75 0.14 225)")
        val js = ThemeColors.script(vars)
        for ((k, v) in vars) assertTrue(js, js.contains("'$k':'$v'"))
        assertTrue(js, js.contains("document.documentElement"))
        assertTrue(js, js.contains("readystatechange"))
        assertTrue(js, js.startsWith("(function(){"))
    }

    @Test
    fun `the script is idempotent and leaves out what it cannot quote`() {
        val a = ThemeColors.script(mapOf("--ember" to "oklch(0.75 0.14 225)", "--background" to "oklch(0.17 0.03 262)"))
        val b = ThemeColors.script(mapOf("--background" to "oklch(0.17 0.03 262)", "--ember" to "oklch(0.75 0.14 225)"))
        assertEquals(a, b)
        val hostile = ThemeColors.script(mapOf("--x" to "a'}alert(1);({'", "--ok" to "#000000"))
        assertFalse(hostile, hostile.contains("alert"))
        assertTrue(hostile, hostile.contains("'--ok':'#000000'"))
    }

    /**
     * The exact script a two-variable theme produces. tests/offline-page.
     * test.mjs runs this same literal against the real offline page and
     * checks the page takes the colours, so both ends are pinned to one
     * string.
     */
    @Test
    fun `the offline page script is exactly what the browser test runs`() {
        assertEquals(
            "(function(){var v={'--background':'oklch(0.17 0.03 262)','--ember':'oklch(0.75 0.14 225)'};" +
                "function a(){var e=document.documentElement;if(!e)return false;" +
                "for(var k in v)e.style.setProperty(k,v[k]);return true;}" +
                "if(!a())document.addEventListener('readystatechange',a);})();",
            ThemeColors.script(mapOf("--background" to "oklch(0.17 0.03 262)", "--ember" to "oklch(0.75 0.14 225)")),
        )
    }

    @Test
    fun `applyToWindow paints the window and the bars below SDK 35`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val midnight = ThemeColors.parseHex("#080f1c")!!
        ThemeColors.applyToWindow(activity, null, midnight)
        val window = activity.window
        assertEquals(midnight, (window.decorView.background as ColorDrawable).color)
        @Suppress("DEPRECATION")
        assertEquals(midnight, window.statusBarColor)
        @Suppress("DEPRECATION")
        assertEquals(midnight, window.navigationBarColor)
        val bars = WindowInsetsControllerCompat(window, window.decorView)
        assertFalse(bars.isAppearanceLightStatusBars)
        assertFalse(bars.isAppearanceLightNavigationBars)

        ThemeColors.applyToWindow(activity, null, ThemeColors.parseHex("#ffffff")!!)
        assertTrue(bars.isAppearanceLightStatusBars)
        assertTrue(bars.isAppearanceLightNavigationBars)
    }

    @Test
    fun `applyToWindow turns off the navigation bar scrim so the strip is the app's colour`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        ThemeColors.applyToWindow(activity, null, ThemeColors.parseHex("#080f1c")!!)
        assertFalse(activity.window.isNavigationBarContrastEnforced)
    }
}

/** The same window on SDK 35, where the bars are transparent and drawn over
 *  the page: applyToWindow leaves their colour alone (the page's own padded
 *  bars show through) but still sets the icons and drops the scrim. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ThemeColorsSdk35Test {
    @Test
    fun `on 35 only the icons and the scrim change, not the bar colours`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val window = activity.window
        @Suppress("DEPRECATION")
        val before = window.navigationBarColor
        val midnight = ThemeColors.parseHex("#080f1c")!!
        ThemeColors.applyToWindow(activity, null, midnight)
        assertEquals(midnight, (window.decorView.background as ColorDrawable).color)
        @Suppress("DEPRECATION")
        assertEquals(before, window.navigationBarColor)
        assertFalse(window.isNavigationBarContrastEnforced)
        ThemeColors.applyToWindow(activity, null, ThemeColors.parseHex("#ffffff")!!)
        assertTrue(WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars)
    }
}
