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
import org.json.JSONObject
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
        NativeLog.info("service", "download service started", JSONObject().put("startId", startId))
        // Every start queues a drain; the single-thread executor serialises
        // them, and a drain that finds nothing pending exits immediately.
        //
        // Gating this on an "already running" flag was a bug: a pin landing
        // after the running drain's last pending() check but before it cleared
        // the flag was dropped by BOTH sides, and its track sat undownloaded
        // until some unrelated pin restarted the service. There is no such gap
        // when the request is queued unconditionally, and the cost of the
        // occasional redundant drain is one pending() call.
        // A drain that throws would kill the executor's worker thread and take
        // the app down with it (an uncaught exception on a pool thread reaches
        // the default handler). The failure is worth a report, not a crash, so
        // catch it here: the finally inside drain() has already stopped the
        // service by this point.
        io.execute {
            try {
                drain(startId)
            } catch (t: Throwable) {
                NativeLog.error(
                    "service",
                    "download drain crashed: " + (t.message ?: t.javaClass.simpleName),
                    JSONObject().put("type", t.javaClass.name),
                )
                Log.e(TAG, "drain crashed", t)
            }
        }
        return START_STICKY
    }

    private fun drain(startId: Int) {
        val baseUrl = ServerConfig.baseUrl(this)
        val api = ServerApi(baseUrl) { CookieManager.getInstance().getCookie(baseUrl) }
        try {
            // The downloading itself lives in OfflineDownloader so it can be
            // unit tested; all this shell adds is the progress notification and
            // the `offline` event the WebView listens to.
            OfflineDownloader(
                store = OfflineStore.shared(this),
                baseUrl = baseUrl,
                authed = api.http,
                plain = plainHttp,
                cacheDir = cacheDir,
                onStart = { pin, progress ->
                    current = progress
                    listener?.invoke(progress)
                    startForeground(1, notification("${pin.name}: ${progress.getInt("done") + 1} of ${progress.getInt("total")}"))
                },
                onDone = { listener?.invoke(null) },
            ).drain()
        } finally {
            cancelled.clear(); current = null
            listener?.invoke(null)
            // stopSelfResult, not stopSelf: it only stops when startId is still
            // the most recent start, so a pin that arrived while this drain was
            // working keeps the service (and its notification) alive for the
            // drain it queued behind us.
            // ServiceCompat, not Service.stopForeground(int): the int overload is
            // API 24+ and minSdk here is 23, so a plain call would crash on 23.
            if (stopSelfResult(startId)) {
                androidx.core.app.ServiceCompat.stopForeground(this, androidx.core.app.ServiceCompat.STOP_FOREGROUND_REMOVE)
                NativeLog.info("service", "download service stopped", JSONObject().put("startId", startId))
            }
        }
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("Ember downloads").setContentText(text).setOngoing(true).build()
    }
}
