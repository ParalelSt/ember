package app.ember.music

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Downloads whatever the index says is pending, one track at a time, as a
 *  foreground service so a pinned playlist finishes with the app closed.
 *  Failures are per track (retry once, then mark failed and move on); a
 *  cancelled pin drops its pending items and any half-written file. */
class OfflineDownloadService : Service() {
    companion object {
        const val TAG = "EmberOffline"
        const val CHANNEL = "ember.downloads"
        private const val ACTION_CANCEL = "app.ember.music.CANCEL_PIN"
        val failed = java.util.Collections.synchronizedMap(HashMap<String, MutableSet<String>>()) // pinId -> trackIds
        /** pinId -> why that pin's first permanent failure happened: "auth",
         *  "storage" or "http". First failure wins, so the reason describes the
         *  problem the user has to fix rather than whatever failed last. Cleared
         *  alongside `failed` whenever the pin is re-synced. */
        val failedReason = java.util.Collections.synchronizedMap(HashMap<String, String>()) // pinId -> reason
        val cancelled = java.util.Collections.synchronizedSet(HashSet<String>())
        @Volatile var current: JSONObject? = null   // { id, done, total, title }
        var listener: ((JSONObject?) -> Unit)? = null

        fun start(ctx: Context) { androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, OfflineDownloadService::class.java)) }
        fun cancel(ctx: Context, pinId: String) { cancelled.add(pinId); ctx.startService(Intent(ctx, OfflineDownloadService::class.java).setAction(ACTION_CANCEL)) }
    }

    private val io = Executors.newSingleThreadExecutor()

    /** Artwork for YouTube/Jamendo tracks is an absolute third-party URL, and
     *  `ServerApi.http` attaches the Ember `pb_auth` cookie to EVERY request it
     *  makes, so fetching art through it would hand the user's session cookie
     *  to hosts that have no business seeing it. Art off the Ember server
     *  itself still goes through the authed client (it needs the cookie). */
    private val plainHttp: OkHttpClient by lazy {
        OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        // The executor's thread is a non-daemon core thread that never times
        // out, so without this every service lifecycle would leak one.
        io.shutdown()
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, notification("Preparing downloads…"))
        // Every start queues a drain; the single-thread executor serialises
        // them, and a drain that finds nothing pending exits immediately.
        //
        // Gating this on an "already running" flag was a bug: a pin landing
        // after the running drain's last pending() check but before it cleared
        // the flag was dropped by BOTH sides, and its track sat undownloaded
        // until some unrelated pin restarted the service. There is no such gap
        // when the request is queued unconditionally, and the cost of the
        // occasional redundant drain is one pending() call.
        io.execute { drain(startId) }
        return START_STICKY
    }

    private fun drain(startId: Int) {
        val store = OfflineStore.shared(this)
        val baseUrl = ServerConfig.baseUrl(this)
        val api = ServerApi(baseUrl) { CookieManager.getInstance().getCookie(baseUrl) }
        try {
            while (true) {
                val next = store.pending().firstOrNull { (pinId, t) -> pinId !in cancelled && failed[pinId]?.contains(t.getString("id")) != true } ?: break
                val (pinId, track) = next
                val pin = store.pins().firstOrNull { it.id == pinId } ?: continue
                val (done, total) = store.progress(pin)
                current = JSONObject().put("id", pinId).put("done", done).put("total", total).put("title", track.optString("title"))
                listener?.invoke(current)
                startForeground(1, notification("${pin.name}: ${done + 1} of $total"))
                var reason = download(api, baseUrl, store, track)
                if (reason != null) reason = download(api, baseUrl, store, track)
                if (reason != null) {
                    failed.getOrPut(pinId) { HashSet() }.add(track.getString("id"))
                    // putIfAbsent is API 24 and minSdk here is 23, so do it by hand.
                    synchronized(failedReason) { if (failedReason[pinId] == null) failedReason[pinId] = reason }
                }
                listener?.invoke(null)
            }
        } finally {
            cancelled.clear(); current = null
            listener?.invoke(null)
            // stopSelfResult, not stopSelf: it only stops when startId is still
            // the most recent start, so a pin that arrived while this drain was
            // working keeps the service (and its notification) alive for the
            // drain it queued behind us.
            // ServiceCompat, not Service.stopForeground(int): the int overload is
            // API 24+ and minSdk here is 23, so a plain call would crash on 23.
            if (stopSelfResult(startId)) androidx.core.app.ServiceCompat.stopForeground(this, androidx.core.app.ServiceCompat.STOP_FOREGROUND_REMOVE)
        }
    }

    /** One track: audio (required) then artwork (best effort).
     *  Returns null on success, or the reason the track failed. */
    private fun download(api: ServerApi, baseUrl: String, store: OfflineStore, track: JSONObject): String? {
        val id = track.getString("id")
        val stream = track.optString("streamUrl")
        val url = if (stream.startsWith("http")) stream else baseUrl + stream
        val tmp = File(cacheDir, "dl-" + store.safeId(id) + ".part")
        try {
            clientFor(api, baseUrl, url).newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) {
                    Log.w(TAG, "$id: HTTP ${res.code}")
                    // 401 survived ServerApi's one retry with a fresh cookie, so
                    // the session really is gone: the user has to sign in again.
                    return if (res.code == 401) "auth" else "http"
                }
                res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
            }
            store.commitAudio(id, tmp)
            val art = track.optString("artworkUrl")
            if (art.startsWith("http")) runCatching {
                clientFor(api, baseUrl, art).newCall(Request.Builder().url(art).build()).execute().use { res ->
                    if (res.isSuccessful) { val a = File(cacheDir, "art-" + store.safeId(id)); res.body!!.byteStream().use { i -> a.outputStream().use { i.copyTo(it) } }; store.commitArt(id, a) }
                }
            }
            return null
        } catch (e: Exception) {
            Log.w(TAG, "$id: ${e.message}"); tmp.delete()
            return if (isOutOfSpace(e)) "storage" else "http"
        }
    }

    /** The authed client only when the URL is served by the Ember server, so
     *  the session cookie never leaves that host. Audio needs this too: Jamendo
     *  tracks carry an absolute third-party streamUrl. See `plainHttp`. */
    private fun clientFor(api: ServerApi, baseUrl: String, url: String): OkHttpClient =
        if (runCatching { java.net.URI(url).host.equals(java.net.URI(baseUrl).host, ignoreCase = true) }.getOrDefault(false))
            api.http else plainHttp

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

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("Ember downloads").setContentText(text).setOngoing(true).build()
    }
}
