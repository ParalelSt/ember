package app.ember.music

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.Collections

/** The download drain itself: pick the next pending track, fetch it, retry
 *  once, record why it gave up, repeat until nothing is pending.
 *
 *  Split out of OfflineDownloadService so the rules that matter (retry, cancel,
 *  failure reasons, what counts as a usable response) can be driven
 *  synchronously from a JVM test against MockWebServer. The service is only the
 *  threading and foreground-notification shell around this.
 *
 *  The failed / failedReason / cancelled sets stay on OfflineDownloadService
 *  rather than being injected here: they are process-wide state the Capacitor
 *  plugin writes too (pin, unpin, retry), and a second copy would drift. */
class OfflineDownloader(
    private val store: OfflineStore,
    private val baseUrl: String,
    /** For URLs on the Ember server: carries the session cookie. */
    private val authed: OkHttpClient,
    /** For everything else, so the cookie never leaves the Ember host. */
    private val plain: OkHttpClient,
    private val cacheDir: File,
    /** About to download this track of this pin (progress is the payload the
     *  web side gets: `{ id, done, total, title }`). */
    private val onStart: (pin: OfflineStore.Pin, progress: JSONObject) -> Unit = { _, _ -> },
    /** That track is finished, one way or another. */
    private val onDone: () -> Unit = {},
) {
    private val failed get() = OfflineDownloadService.failed
    private val failedReason get() = OfflineDownloadService.failedReason

    private object CancelledSentinel

    private fun isCancelled(pinId: String) = pinId in OfflineDownloadService.cancelled

    fun drain() {
        cacheDir.mkdirs()
        while (true) {
            val next = store.pending().firstOrNull { (pinId, t) ->
                !isCancelled(pinId) && failed[pinId]?.contains(t.getString("id")) != true
            } ?: break
            val (pinId, track) = next
            val pin = store.pins().firstOrNull { it.id == pinId } ?: continue
            val (done, total) = store.progress(pin)
            onStart(pin, JSONObject().put("id", pinId).put("done", done).put("total", total).put("title", track.optString("title")))
            var reason: Any? = download(pinId, track)
            // A pin cancelled mid-track is done: neither retry it nor record a
            // failure the user would then see on a pin they just dropped.
            val wasCancelled = isCancelled(pinId)
            if (reason != null && !wasCancelled) reason = download(pinId, track)
            if (reason is String && !wasCancelled) {
                failed.getOrPut(pinId) { Collections.synchronizedSet(HashSet()) }.add(track.getString("id"))
                // putIfAbsent is API 24 and minSdk here is 23, so do it by hand.
                synchronized(failedReason) { if (failedReason[pinId] == null) failedReason[pinId] = reason }
            }
            onDone()
        }
    }

    /** One track: audio (required) then artwork (best effort).
     *  Returns null on success, or the reason the track failed.
     *  Returns CancelledSentinel if cancelled mid-download. */
    fun download(pinId: String, track: JSONObject): Any? {
        val id = track.getString("id")
        val stream = track.optString("streamUrl")
        val url = if (stream.startsWith("http")) stream else baseUrl + stream
        val tmp = File(cacheDir, "dl-" + store.safeId(id) + ".part")
        try {
            clientFor(url).newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) {
                    Log.w(OfflineDownloadService.TAG, "$id: HTTP ${res.code}")
                    // 401 survived ServerApi's one retry with a fresh cookie, so
                    // the session really is gone: the user has to sign in again.
                    return if (res.code == 401) "auth" else "http"
                }
                // A signed-out session is answered with a redirect to the sign-in
                // page, which OkHttp follows to a 200 HTML body. Saving that as
                // audio looks like success and only fails at play time, so any
                // non-audio body counts as a failure here.
                val type = res.header("Content-Type").orEmpty()
                val landedOnAuth = res.request.url.encodedPath.startsWith("/auth")
                if (landedOnAuth || type.startsWith("text/html")) {
                    Log.w(OfflineDownloadService.TAG, "$id: got ${type.ifEmpty { "no content type" }} from ${res.request.url.encodedPath}")
                    return if (landedOnAuth) "auth" else "http"
                }
                res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
            }
            // Cancelled while these bytes were in flight: they belong to a pin
            // the user has dropped, so throw the part file away rather than
            // committing a download nobody asked for any more.
            if (isCancelled(pinId)) { tmp.delete(); return CancelledSentinel }
            store.commitAudio(id, tmp)
            val art = track.optString("artworkUrl")
            if (art.startsWith("http")) runCatching {
                clientFor(art).newCall(Request.Builder().url(art).build()).execute().use { res ->
                    if (!res.isSuccessful) {
                        Log.w(OfflineDownloadService.TAG, "$id: art HTTP ${res.code}")
                        return@use
                    }
                    val type = res.header("Content-Type").orEmpty()
                    val landedOnAuth = res.request.url.encodedPath.startsWith("/auth")
                    if (landedOnAuth || type.startsWith("text/html")) {
                        Log.w(OfflineDownloadService.TAG, "$id: art got ${type.ifEmpty { "no content type" }} from ${res.request.url.encodedPath}")
                        return@use
                    }
                    val a = File(cacheDir, "art-" + store.safeId(id))
                    res.body!!.byteStream().use { i -> a.outputStream().use { i.copyTo(it) } }
                    store.commitArt(id, a)
                }
            }
            return null
        } catch (e: Exception) {
            Log.w(OfflineDownloadService.TAG, "$id: ${e.message}"); tmp.delete()
            return if (isOutOfSpace(e)) "storage" else "http"
        }
    }

    /** The authed client only when the URL is served by the Ember server, so
     *  the session cookie never leaves that host. Audio needs this too: Jamendo
     *  tracks carry an absolute third-party streamUrl. */
    private fun clientFor(url: String): OkHttpClient =
        if (runCatching { java.net.URI(url).host.equals(java.net.URI(baseUrl).host, ignoreCase = true) }.getOrDefault(false))
            authed else plain

    /** A full disk reaches us as an IOException (or an ErrnoException cause)
     *  naming ENOSPC. Matching on the message rather than the type matters
     *  because a dropped connection is an IOException too, and calling that
     *  "not enough storage" would send the user chasing the wrong problem. */
    private fun isOutOfSpace(e: Throwable): Boolean {
        var t: Throwable? = e
        while (t != null) {
            val m = t.message.orEmpty()
            if (m.contains("ENOSPC") || m.contains("No space left", ignoreCase = true)) return true
            t = t.cause
        }
        return false
    }
}
