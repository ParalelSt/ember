package app.ember.music

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The page asks which app it runs in (apps/web/lib/shellVersion.ts):
 * `info()` answers `{ version: "0.4.14" }`, shown in the settings footer
 * after the web build. An APK from before this plugin has none, and the page
 * then shows the web build alone.
 *
 * `flushCookies()`: the page signed in or out (apps/web/lib/nativeCookies.ts);
 * the session cookie goes to disk now, so a process killed straight after
 * does not lose it (CookieFlush).
 *
 * `scanQr()`: "Scan QR code" (apps/web/lib/qrScan/nativeScan.ts), Google's
 * code scanner; always resolves `{ status, value? }` (QrScan).
 */
@CapacitorPlugin(name = "EmberApp")
class EmberAppPlugin : Plugin() {
    @PluginMethod
    fun info(call: PluginCall) {
        val version = AppVersion.name(context) ?: return call.reject("the app has no version name", "no-version")
        call.resolve(JSObject().put("version", version))
    }

    @PluginMethod
    fun flushCookies(call: PluginCall) {
        CookieFlush.now()
        call.resolve()
    }

    @PluginMethod
    fun scanQr(call: PluginCall) {
        val host = activity ?: return call.resolve(toJs(QrScanOutcome.Unavailable))
        val answered = AtomicBoolean(false)
        host.runOnUiThread {
            QrScan.start(host) { outcome ->
                if (answered.compareAndSet(false, true)) call.resolve(toJs(outcome))
            }
        }
    }

    private fun toJs(outcome: QrScanOutcome): JSObject {
        val js = JSObject()
        QrScan.answer(outcome).forEach { (k, v) -> js.put(k, v) }
        return js
    }
}
