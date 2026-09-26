package app.ember.music

import android.content.pm.ApplicationInfo
import android.webkit.WebSettings
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser
import java.net.URI

/** No cleartext HTTP and no mixed content (security audit 2026-09-25, M5).
 *  On main the manifest allowed cleartext to every host and the WebView
 *  loaded http content into https pages. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NetworkSecurityTest {
    private val app = RuntimeEnvironment.getApplication()

    private class Config(val baseCleartext: Boolean?, val cleartextDomains: Set<String>)

    private fun readConfig(): Config {
        val id = app.resources.getIdentifier("network_security_config", "xml", app.packageName)
        check(id != 0) { "no res/xml/network_security_config" }
        val xml = app.resources.getXml(id)
        var base: Boolean? = null
        val domains = mutableSetOf<String>()
        var inCleartextDomainConfig = false
        while (xml.next() != XmlPullParser.END_DOCUMENT) {
            if (xml.eventType == XmlPullParser.START_TAG) when (xml.name) {
                "base-config" -> base = xml.getAttributeValue(null, "cleartextTrafficPermitted")?.toBoolean()
                "domain-config" -> inCleartextDomainConfig = xml.getAttributeValue(null, "cleartextTrafficPermitted") == "true"
                "domain" -> if (inCleartextDomainConfig) { xml.next(); domains += xml.text.trim() }
            }
        }
        return Config(base, domains)
    }

    @Test fun `cleartext is off for every host`() {
        assertEquals(false, readConfig().baseCleartext)
    }

    @Test fun `the only cleartext exception is the configured Ember server, and only when it is http`() {
        val server = URI(ServerConfig.baseUrl(app))
        val expected = if (server.scheme == "http") setOf(server.host) else emptySet()
        assertEquals(expected, readConfig().cleartextDomains)
    }

    @Test fun `the manifest no longer allows cleartext everywhere`() {
        val info = app.packageManager.getApplicationInfo(app.packageName, 0)
        assertFalse(info.flags and ApplicationInfo.FLAG_USES_CLEARTEXT_TRAFFIC != 0)
    }

    @Test fun `the WebView refuses mixed content`() {
        val webView = WebView(app)
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        WebSecurity.lockDown(webView)
        assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, webView.settings.mixedContentMode)
    }
}
