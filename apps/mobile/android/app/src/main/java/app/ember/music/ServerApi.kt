package app.ember.music

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** The Ember server as seen from native code.
 *
 *  Auth is the WebView's `pb_auth` cookie. `cookies()` is asked on EVERY
 *  request rather than once, because the web app refreshes the cookie in the
 *  background; a 401 gets one retry with a freshly read cookie, which covers
 *  "signed in again on the phone while the car was open". */
class ServerApi(val baseUrl: String, private val cookies: () -> String?) {
    private val cookieAuth = Interceptor { chain ->
        val first = chain.request().withCookie(cookies())
        val res = chain.proceed(first)
        if (res.code != 401) return@Interceptor res
        val fresh = cookies()
        if (fresh.isNullOrBlank() || fresh == first.header("Cookie")) return@Interceptor res
        res.close()
        chain.proceed(chain.request().withCookie(fresh))
    }

    val http: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(cookieAuth)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun Request.withCookie(cookie: String?): Request =
        if (cookie.isNullOrBlank()) this else newBuilder().header("Cookie", cookie).build()

    fun getJson(path: String): JSONObject {
        http.newCall(Request.Builder().url(baseUrl + path).build()).execute().use { res ->
            if (!res.isSuccessful) throw IOException("GET $path -> ${res.code}")
            return JSONObject(res.body?.string().orEmpty())
        }
    }

    fun postJson(path: String, body: JSONObject) {
        val req = Request.Builder().url(baseUrl + path)
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("POST $path -> ${res.code}")
        }
    }

    private fun tracks(json: JSONObject, key: String = "tracks"): List<JSONObject> {
        val arr: JSONArray = json.optJSONArray(key) ?: JSONArray()
        return (0 until arr.length()).map { arr.getJSONObject(it) }
    }

    fun playlists(): List<JSONObject> = tracks(getJson("/api/playlists"), "playlists")
    fun playlistTracks(id: String): List<JSONObject> = tracks(getJson("/api/playlists/$id"))
    fun likes(): List<JSONObject> = tracks(getJson("/api/likes"))
    fun history(): List<JSONObject> = tracks(getJson("/api/history"))
    fun uploads(): List<JSONObject> = tracks(getJson("/api/uploads"))
    fun search(q: String): List<JSONObject> = tracks(getJson("/api/search?q=" + java.net.URLEncoder.encode(q, "UTF-8")))
    fun recommended(seedSourceId: String): List<JSONObject> =
        tracks(getJson("/api/youtube/recommended?seed=" + java.net.URLEncoder.encode(seedSourceId, "UTF-8")))
    fun recordPlay(track: JSONObject) = postJson("/api/history", JSONObject().put("track", track))
}
