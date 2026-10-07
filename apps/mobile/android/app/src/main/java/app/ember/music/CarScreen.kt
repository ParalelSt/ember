package app.ember.music

import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.webkit.WebView

/**
 * Tells the page it is on a car screen. A car display is landscape with a
 * short CSS viewport, which the web's phone-rotation lock mistakes for a
 * phone on its side; the page reads this marker from the user agent and
 * lifts the lock (apps/web/lib/carUa.ts, same string).
 */
object CarScreen {
    const val MARKER = "EmberCar"

    fun isCar(context: Context): Boolean {
        val automotive = context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)
        val carMode = (context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) ==
            Configuration.UI_MODE_TYPE_CAR
        return automotive || carMode
    }

    fun tag(userAgent: String): String =
        if (userAgent.contains(MARKER)) userAgent else "$userAgent $MARKER"

    /** Call before the page loads. A phone is left untouched. */
    fun apply(context: Context, webView: WebView?) {
        val settings = webView?.settings ?: return
        if (!isCar(context)) return
        settings.userAgentString = tag(settings.userAgentString ?: "")
    }
}
