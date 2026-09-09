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
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

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
        val cancelled = java.util.Collections.synchronizedSet(HashSet<String>())
        @Volatile var current: JSONObject? = null   // { id, done, total, title }
        var listener: ((JSONObject?) -> Unit)? = null

        fun start(ctx: Context) { androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, OfflineDownloadService::class.java)) }
        fun cancel(ctx: Context, pinId: String) { cancelled.add(pinId); ctx.startService(Intent(ctx, OfflineDownloadService::class.java).setAction(ACTION_CANCEL)) }
    }

    private val io = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, notification("Preparing downloads…"))
        if (running.compareAndSet(false, true)) io.execute { drain() }
        return START_STICKY
    }

    private fun drain() {
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
                val ok = download(api, baseUrl, store, track) || download(api, baseUrl, store, track)
                if (!ok) failed.getOrPut(pinId) { HashSet() }.add(track.getString("id"))
                listener?.invoke(null)
            }
        } finally {
            cancelled.clear(); current = null; running.set(false)
            listener?.invoke(null)
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
        }
    }

    /** One track: audio (required) then artwork (best effort). */
    private fun download(api: ServerApi, baseUrl: String, store: OfflineStore, track: JSONObject): Boolean {
        val id = track.getString("id")
        val stream = track.optString("streamUrl")
        val url = if (stream.startsWith("http")) stream else baseUrl + stream
        val tmp = File(cacheDir, "dl-" + store.safeId(id) + ".part")
        try {
            api.http.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) { Log.w(TAG, "$id: HTTP ${res.code}"); return false }
                res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
            }
            store.commitAudio(id, tmp)
            val art = track.optString("artworkUrl")
            if (art.startsWith("http")) runCatching {
                api.http.newCall(Request.Builder().url(art).build()).execute().use { res ->
                    if (res.isSuccessful) { val a = File(cacheDir, "art-" + store.safeId(id)); res.body!!.byteStream().use { i -> a.outputStream().use { i.copyTo(it) } }; store.commitArt(id, a) }
                }
            }
            return true
        } catch (e: Exception) {
            Log.w(TAG, "$id: ${e.message}"); tmp.delete(); return false
        }
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("Ember downloads").setContentText(text).setOngoing(true).build()
    }
}
