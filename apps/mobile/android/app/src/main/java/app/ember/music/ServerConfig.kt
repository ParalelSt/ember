package app.ember.music

import android.content.Context
import org.json.JSONObject

/** The server this build points at. Capacitor bakes `server.url` into
 *  assets/capacitor.config.json (see capacitor.config.ts), and the service has
 *  no WebView to ask, so read the same file. */
object ServerConfig {
    fun baseUrl(context: Context): String {
        val text = context.assets.open("capacitor.config.json").bufferedReader().use { it.readText() }
        val url = JSONObject(text).optJSONObject("server")?.optString("url").orEmpty()
        return (if (url.isBlank()) "http://localhost:3000" else url).trimEnd('/')
    }
}
