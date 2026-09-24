package app.ember.music

import android.app.Activity
import android.os.Build
import android.webkit.WebView
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

/**
 * The shell's half of the person's Ember theme.
 *
 * The page is themed by the server (the theme is in the first HTML byte), so
 * what is left here is what the page cannot paint: the system bars, the
 * blank between the splash and the first byte, and the bundled offline page,
 * which lives on a different origin and never sees the account.
 *
 * The web app reports each theme through EmberThemePlugin.apply; the last one
 * is kept in SharedPreferences so the next cold start opens on it.
 *
 * Everything except applyToWindow is pure, so the JVM tests (ThemeColorsTest)
 * can hold it.
 */
object ThemeColors {
    const val PREFS = "ember_theme"
    const val KEY_BACKGROUND = "background"
    const val KEY_SCHEME = "scheme"
    const val KEY_VARS = "vars"

    /** Ember's own background (`oklch(0.16 0.005 260)`), for a phone that has
     *  never reported a theme: the first launch opens on Ember, not white. */
    const val DEFAULT_BACKGROUND = "#0c0d0f"

    private val NAME = Regex("^--[a-z0-9-]{1,40}$")
    private val VALUE = Regex("^[A-Za-z0-9 .,%()/#+-]{1,80}$")

    /** `#rrggbb` (either case) as an opaque ARGB int, or null for anything
     *  else: a colour that cannot be read must not paint the window. */
    @JvmStatic
    fun parseHex(hex: String?): Int? {
        val s = hex?.trim() ?: return null
        if (s.length != 7 || s[0] != '#') return null
        val rgb = s.substring(1)
        if (!rgb.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
        return (0xFF shl 24) or rgb.toInt(16)
    }

    /** WCAG relative luminance of an ARGB colour, 0..1. */
    @JvmStatic
    fun luminance(argb: Int): Double {
        fun channel(v: Int): Double {
            val c = v / 255.0
            return if (c <= 0.04045) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel((argb shr 16) and 0xFF) +
            0.7152 * channel((argb shr 8) and 0xFF) +
            0.0722 * channel(argb and 0xFF)
    }

    /** A light background needs dark bar icons. Every v1 theme is dark, so
     *  today this is always false; the threshold is here for a light theme. */
    @JvmStatic
    fun isLight(argb: Int): Boolean = luminance(argb) > 0.4

    /**
     * The theme's CSS variables from the JSON the page sent, keeping only
     * names and values that look like what derive() produces. The result is
     * written into a script, so nothing that could break out of a string
     * literal gets through; bad JSON is an empty map.
     */
    @JvmStatic
    fun parseVars(json: String?): Map<String, String> {
        if (json.isNullOrBlank()) return emptyMap()
        val obj = try {
            JSONObject(json)
        } catch (e: Exception) {
            return emptyMap()
        }
        val out = sortedMapOf<String, String>()
        for (name in obj.keys()) {
            val value = obj.opt(name) as? String ?: continue
            if (NAME.matches(name) && VALUE.matches(value)) out[name] = value
        }
        return out
    }

    /**
     * The script that puts the variables on the offline page's `<html>`.
     * Same shape as SafeAreaInsets.script: self-contained, idempotent, and
     * retried on readystatechange because a document-start script can run
     * before `document.documentElement` exists. Anything parseVars would
     * refuse is left out here too.
     */
    @JvmStatic
    fun script(vars: Map<String, String>): String {
        val pairs = StringBuilder()
        for ((name, value) in vars.toSortedMap()) {
            if (!NAME.matches(name) || !VALUE.matches(value)) continue
            if (pairs.isNotEmpty()) pairs.append(',')
            pairs.append('\'').append(name).append("':'").append(value).append('\'')
        }
        return "(function(){var v={$pairs};" +
            "function a(){var e=document.documentElement;if(!e)return false;" +
            "for(var k in v)e.style.setProperty(k,v[k]);return true;}" +
            "if(!a())document.addEventListener('readystatechange',a);})();"
    }

    /**
     * Paint the chrome around the page: the WebView's and the window's own
     * background (what shows before the first byte and behind a loading
     * page), the bar icons, and below SDK 35 the bars themselves. On 35 the
     * bars are transparent and drawn over the page, so the page's own
     * background already is the bar colour and only the icons need setting.
     * Main thread only.
     */
    @JvmStatic
    fun applyToWindow(activity: Activity, webView: WebView?, background: Int) {
        val window = activity.window ?: return
        val light = isLight(background)
        webView?.setBackgroundColor(background)
        window.decorView.setBackgroundColor(background)
        val bars = WindowInsetsControllerCompat(window, window.decorView)
        bars.isAppearanceLightStatusBars = light
        bars.isAppearanceLightNavigationBars = light
        if (Build.VERSION.SDK_INT < 35) {
            @Suppress("DEPRECATION")
            window.statusBarColor = background
            @Suppress("DEPRECATION")
            window.navigationBarColor = background
        }
    }
}
