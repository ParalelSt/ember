package app.ember.music

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
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
    companion object {
        /** What [reachable] asks for: one of the web app's public icons. */
        const val PROBE_PATH = "/favicon-16.png"
    }

    private val server = baseUrl.toHttpUrlOrNull()

    /** The cookie is the whole Ember session, so it goes to the Ember server
     *  and nowhere else (security audit 2026-09-25, S3). This client also
     *  plays whatever stream URL a track carries, and the player service is
     *  exported for the car: any app on the phone can hand it a track whose
     *  streamUrl points at its own server, which used to receive pb_auth. */
    private val cookieAuth = Interceptor { chain ->
        if (!isServer(chain.request().url)) return@Interceptor chain.proceed(chain.request())
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

    /** For [reachable] only: short waits, no redirects, and connections of
     *  its own, so a socket the stream left hanging cannot answer for it. */
    private val probeHttp: OkHttpClient by lazy {
        http.newBuilder()
            .connectionPool(okhttp3.ConnectionPool())
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    /** Whether the server can be reached at all: any HTTP answer counts. A
     *  small static file, so asking costs the server nothing. Blocking. */
    fun reachable(): Boolean = try {
        probeHttp.newCall(Request.Builder().url(baseUrl + PROBE_PATH).head().build()).execute().use { true }
    } catch (e: IOException) {
        false
    }

    /** Same scheme, host and port as baseUrl. */
    fun isServer(url: HttpUrl): Boolean =
        server != null && url.scheme == server.scheme && url.host == server.host && url.port == server.port

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

    /** POST that answers JSON. */
    fun postForJson(path: String, body: JSONObject): JSONObject {
        val req = Request.Builder().url(baseUrl + path)
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("POST $path -> ${res.code}")
            return JSONObject(res.body?.string().orEmpty())
        }
    }

    /** Signed links a cast device can play without the cookie (the server's
     *  lib/streamToken), for up to 500 track ids. */
    fun castLinks(ids: List<String>): Map<String, CastLink> =
        CastItems.parseSignResponse(postForJson("/api/cast/sign", JSONObject().put("ids", JSONArray(ids))))

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
    /** Today's chart (Home's "Trending right now"), in rank order. */
    fun trending(): List<JSONObject> = tracks(getJson("/api/youtube/trending"))
    fun recommended(seedSourceId: String): List<JSONObject> =
        tracks(getJson("/api/youtube/recommended?seed=" + java.net.URLEncoder.encode(seedSourceId, "UTF-8")))
    /** The song's normalization gain in dB; null when not measured yet. */
    fun trackGain(id: String): Double? {
        // ?v=2: the -9 LUFS policy, past any answer cached for the old -14 one.
        val json = getJson("/api/tracks/" + java.net.URLEncoder.encode(id, "UTF-8") + "/loudness?v=2")
        if (!json.has("gainDb") || json.isNull("gainDb")) return null
        return json.optDouble("gainDb").takeIf { !it.isNaN() }
    }
    fun recordPlay(track: JSONObject) = postJson("/api/history", JSONObject().put("track", track))

    /** Live radio (the web app's lib/radio): each station's playable item,
     *  the `track` the server builds for it (a stream through the host's
     *  proxy, no length). */
    private fun stations(json: JSONObject): List<JSONObject> {
        val arr = json.optJSONArray("stations") ?: JSONArray()
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.optJSONObject("track") }
    }

    /** Stations near a point, rounded to ~0.1 degree here already: the exact
     *  place never leaves the phone. */
    fun radioNearby(lat: Double, lng: Double): List<JSONObject> {
        val (la, lo) = RadioPlaces.rounded(lat, lng)
        return stations(getJson("/api/radio/nearby?lat=$la&lng=$lo"))
    }
    fun radioCountry(code: String): List<JSONObject> =
        stations(getJson("/api/radio/country?code=" + java.net.URLEncoder.encode(code, "UTF-8")))
    fun radioFavorites(): List<JSONObject> = stations(getJson("/api/radio/favorites"))

    /** The car's heart button: like (the whole track, the server files it in
     *  the catalog) and unlike (by the track's id). Both are idempotent on
     *  the server. */
    fun like(track: JSONObject) = postJson("/api/likes", JSONObject().put("track", track))
    fun unlike(id: String) {
        val req = Request.Builder().url(baseUrl + "/api/likes/" + java.net.URLEncoder.encode(id, "UTF-8").replace("+", "%20")).delete().build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("DELETE /api/likes -> ${res.code}")
        }
    }
}
