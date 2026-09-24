package app.ember.music

import android.content.Context
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The page reports its theme here after every change (apps/web/lib/theme/
 * native.ts): `apply({ background: '#rrggbb', scheme, vars: '<json>' })`.
 *
 * The value is kept for the next cold start (MainActivity.applyStoredTheme)
 * and applied to the window now: the bars, the window background and the
 * offline page's variables. An APK from before themes has no such plugin,
 * and the web side treats that as a no-op.
 */
@CapacitorPlugin(name = "EmberTheme")
class EmberThemePlugin : Plugin() {
    @PluginMethod
    fun apply(call: PluginCall) {
        val background = call.getString("background")
        val color = ThemeColors.parseHex(background)
            ?: return call.reject("not a colour: $background", "bad-colour")
        val scheme = if (call.getString("scheme") == "light") "light" else "dark"
        val vars = call.getString("vars") ?: "{}"
        context.getSharedPreferences(ThemeColors.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(ThemeColors.KEY_BACKGROUND, background!!.trim().lowercase())
            .putString(ThemeColors.KEY_SCHEME, scheme)
            .putString(ThemeColors.KEY_VARS, vars)
            .apply()
        bridge.executeOnMainThread {
            val host = activity
            if (host is MainActivity) host.applyTheme(color, vars)
            else if (host != null) ThemeColors.applyToWindow(host, bridge.webView, color)
            call.resolve()
        }
    }
}
