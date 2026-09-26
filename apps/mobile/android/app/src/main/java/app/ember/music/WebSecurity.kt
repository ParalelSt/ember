package app.ember.music

import android.webkit.WebSettings
import android.webkit.WebView

/** WebView settings that must hold whatever capacitor.config.json says
 *  (security audit 2026-09-25, M5). */
object WebSecurity {
    /** An https page never loads http scripts, frames or media: on the
     *  Tailscale Funnel host those would be readable and rewritable by anyone
     *  on the path. An http server is unaffected (its page is not https). */
    fun lockDown(webView: WebView?) {
        webView?.settings?.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }
}
