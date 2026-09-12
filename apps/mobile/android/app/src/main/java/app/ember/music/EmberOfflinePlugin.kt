package app.ember.music

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/** The web UI's handle on offline downloads: pin lists, read status, clear.
 *  Every change is also pushed as an `offline` event so the UI never polls.
 *
 *  The status shape (also the `offline` event payload) is:
 *
 *      {
 *        pins: [{ id, name, total, done, failed, failedReason, downloading, trackIds }],
 *        trackFiles: { [trackId]: absolutePath },   // downloaded audio
 *        artFiles:   { [trackId]: absolutePath },   // downloaded artwork, a subset
 *        totalBytes,
 *        progress?: { id, done, total, title }      // only while downloading
 *      }
 *
 *  Paths are absolute app-private files: the WebView cannot load them directly,
 *  it has to put them through `Capacitor.convertFileSrc`. */
@CapacitorPlugin(name = "EmberOffline")
class EmberOfflinePlugin : Plugin() {
    private companion object {
        /** Native diagnostics (see NativeLog), forwarded into the web logger. */
        const val EVENT_LOG = "nativeLog"
    }

    private val store by lazy { OfflineStore.shared(context) }

    /** Held so handleOnDestroy can tell OUR listener apart from a newer
     *  plugin instance's. Called by OfflineDownloadService from its own
     *  executor thread, not the main thread, so the notify has to hop over:
     *  notifyListeners ends up in the WebView's JS bridge, which Capacitor
     *  only guarantees is safe from the main thread. */
    private val progressListener: (JSONObject?) -> Unit = { progress ->
        val payload = status(progress)
        bridge.executeOnMainThread { notifyListeners("offline", payload) }
    }

    /** NativeLog's delivery path. Reports FALSE while the WebView has no
     *  `nativeLog` listener, because Capacitor silently drops an event with no
     *  listeners; refusing it instead keeps it buffered until the page is ready
     *  for it. Runs on whatever thread emitted the log (often a background
     *  executor), so the actual notify is posted to the main thread; the
     *  `hasListeners` gate itself is cheap and thread-safe to check inline. */
    private val logSink: (JSONObject) -> Boolean = { event ->
        if (!hasListeners(EVENT_LOG)) false
        else {
            bridge.executeOnMainThread { notifyListeners(EVENT_LOG, JSObject(event.toString())) }
            true
        }
    }

    override fun load() {
        OfflineDownloadService.listener = progressListener
        NativeLog.attach(logSink)
    }

    /** Capacitor only delivers to listeners that already exist, so the events
     *  buffered before the page loaded have to be pushed the moment it
     *  subscribes: attach() drains them. */
    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    override fun addListener(call: PluginCall) {
        super.addListener(call)
        if (call.getString("eventName") == EVENT_LOG) NativeLog.attach(logSink)
    }

    override fun handleOnDestroy() {
        // The listener is a process-wide static: left set, it keeps this dead
        // plugin (and the WebView behind notifyListeners) reachable for the life
        // of the process. Only clear it if a newer instance has not taken over.
        if (OfflineDownloadService.listener === progressListener) OfflineDownloadService.listener = null
        NativeLog.detach(logSink)
        super.handleOnDestroy()
    }

    private fun status(progress: JSONObject? = OfflineDownloadService.current): JSObject {
        val pins = JSArray()
        for (p in store.pins()) {
            val (done, total) = store.progress(p)
            pins.put(JSObject().put("id", p.id).put("name", p.name).put("total", total).put("done", done)
                .put("failed", OfflineDownloadService.failed[p.id]?.size ?: 0)
                // Explicit JSON null, not an absent key, so the web type
                // (failedReason: string | null) is honest about "no failures".
                .put("failedReason", OfflineDownloadService.failedReason[p.id] ?: JSONObject.NULL)
                .put("downloading", progress?.optString("id") == p.id)
                // Exact membership, not just the count: the web side decides a
                // pin is stale by comparing these ids against the live list.
                .put("trackIds", JSArray(p.trackIds)))
        }
        val files = JSObject()
        store.trackFiles().forEach { (id, f) -> files.put(id, f.absolutePath) }
        // Artwork lives in its own map because it is best effort: a track with
        // audio may have no art, and the web side must not read "no art" as
        // "not downloaded".
        val art = JSObject()
        store.artFiles().forEach { (id, f) -> art.put(id, f.absolutePath) }
        val out = JSObject().put("pins", pins).put("trackFiles", files).put("artFiles", art).put("totalBytes", store.totalBytes())
        if (progress != null) out.put("progress", JSObject(progress.toString()))
        return out
    }

    @PluginMethod fun status(call: PluginCall) = call.resolve(status())

    /** The track JSON of one pin, in pin order. `status()` deliberately carries
     *  only ids and file paths, so the cold-start page (public/offline.html) has
     *  no titles to show without this. */
    @PluginMethod fun tracks(call: PluginCall) {
        val id = call.getString("id") ?: return reject(call, "tracks", "id required")
        val pin = store.pins().firstOrNull { it.id == id } ?: return reject(call, "tracks", "no such pin")
        val out = JSArray()
        pin.trackIds.forEach { tid -> store.track(tid)?.let { out.put(it) } }
        call.resolve(JSObject().put("tracks", out))
    }

    /** The server this build points at. The offline page is loaded from the
     *  bundled assets, so `location` tells it nothing about where to retry. */
    @PluginMethod fun serverUrl(call: PluginCall) =
        call.resolve(JSObject().put("url", ServerConfig.baseUrl(context)))

    @PluginMethod fun pin(call: PluginCall) {
        val id = call.getString("id") ?: return reject(call, "pin", "id required")
        val name = call.getString("name") ?: id
        val arr = call.getArray("tracks") ?: JSArray()
        val tracks = (0 until arr.length()).map { arr.getJSONObject(it) }
        // Pinning again undoes an earlier unpin/cancel: without this the id stays
        // in `cancelled` (only a running drain clears that set), and the service
        // would skip the pin forever. Same for `failed`, so a retry is possible.
        OfflineDownloadService.cancelled.remove(id)
        OfflineDownloadService.failed.remove(id)
        OfflineDownloadService.failedReason.remove(id)
        requestNotificationsIfNeeded()
        store.upsertPin(id, name, tracks)
        OfflineDownloadService.start(context)
        call.resolve(status())
    }

    /** Try the tracks of this pin that gave up again. No track list is needed:
     *  the index already has every track's JSON, and `pending()` offers only
     *  the ones whose audio is still missing, so clearing the failure state and
     *  starting the service re-queues exactly the failed tracks. Deliberately
     *  NOT `pin()`: that one re-syncs the pin to a track list from JS, which a
     *  retry has no business doing (a stale list would drop tracks).
     *  Rejects unknown pin ids with "no such pin". */
    @PluginMethod fun retry(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        if (store.pins().none { it.id == id }) return call.reject("no such pin")
        // Defensive: clear cancelled state so the service will resume this pin,
        // and clear failure state so the drain re-queues the failed tracks.
        OfflineDownloadService.cancelled.remove(id)
        OfflineDownloadService.failed.remove(id)
        OfflineDownloadService.failedReason.remove(id)
        requestNotificationsIfNeeded()
        OfflineDownloadService.start(context)
        call.resolve(status())
    }

    @PluginMethod fun unpin(call: PluginCall) {
        val id = call.getString("id") ?: return reject(call, "unpin", "id required")
        OfflineDownloadService.cancelled.add(id)
        store.removePin(id)
        OfflineDownloadService.failed.remove(id)
        OfflineDownloadService.failedReason.remove(id)
        call.resolve(status()); notifyListeners("offline", status())
    }

    @PluginMethod fun cancel(call: PluginCall) {
        val id = call.getString("id") ?: return reject(call, "cancel", "id required")
        OfflineDownloadService.cancel(context, id)
        store.removePin(id)
        call.resolve(status()); notifyListeners("offline", status())
    }

    @PluginMethod fun clearAll(call: PluginCall) {
        store.pins().forEach { OfflineDownloadService.cancelled.add(it.id) }
        store.clearAll(); OfflineDownloadService.failed.clear(); OfflineDownloadService.failedReason.clear()
        call.resolve(status()); notifyListeners("offline", status())
    }

    /** Reject AND report. A rejected call reaches the WebView as a bare promise
     *  rejection that the caller usually swallows, so the reason would never
     *  show up in a bug report otherwise. */
    private fun reject(call: PluginCall, method: String, reason: String) {
        NativeLog.warn("offline", "$method rejected: $reason")
        call.reject(reason)
    }

    /** On Android 13+ the download notification is dropped silently until the
     *  user grants POST_NOTIFICATIONS, so ask when a pin is made and the
     *  permission is still missing (Android itself stops showing the dialog
     *  once it has been refused). Fire and forget on purpose: the download must
     *  not wait on an answer, and a refusal only costs the progress notice. */
    private fun requestNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val activity = activity ?: return
        runCatching { ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 8731) }
    }
}
