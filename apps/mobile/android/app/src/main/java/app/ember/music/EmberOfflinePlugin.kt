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
 *  Every change is also pushed as an `offline` event so the UI never polls. */
@CapacitorPlugin(name = "EmberOffline")
class EmberOfflinePlugin : Plugin() {
    private val store by lazy { OfflineStore.shared(context) }

    /** Held so handleOnDestroy can tell OUR listener apart from a newer
     *  plugin instance's. */
    private val progressListener: (JSONObject?) -> Unit = { progress -> notifyListeners("offline", status(progress)) }

    override fun load() {
        OfflineDownloadService.listener = progressListener
    }

    override fun handleOnDestroy() {
        // The listener is a process-wide static: left set, it keeps this dead
        // plugin (and the WebView behind notifyListeners) reachable for the life
        // of the process. Only clear it if a newer instance has not taken over.
        if (OfflineDownloadService.listener === progressListener) OfflineDownloadService.listener = null
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
        val out = JSObject().put("pins", pins).put("trackFiles", files).put("totalBytes", store.totalBytes())
        if (progress != null) out.put("progress", JSObject(progress.toString()))
        return out
    }

    @PluginMethod fun status(call: PluginCall) = call.resolve(status())

    /** The track JSON of one pin, in pin order. `status()` deliberately carries
     *  only ids and file paths, so the cold-start page (public/offline.html) has
     *  no titles to show without this. */
    @PluginMethod fun tracks(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val pin = store.pins().firstOrNull { it.id == id } ?: return call.reject("no such pin")
        val out = JSArray()
        pin.trackIds.forEach { tid -> store.track(tid)?.let { out.put(it) } }
        call.resolve(JSObject().put("tracks", out))
    }

    /** The server this build points at. The offline page is loaded from the
     *  bundled assets, so `location` tells it nothing about where to retry. */
    @PluginMethod fun serverUrl(call: PluginCall) =
        call.resolve(JSObject().put("url", ServerConfig.baseUrl(context)))

    @PluginMethod fun pin(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
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

    @PluginMethod fun unpin(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        OfflineDownloadService.cancelled.add(id)
        store.removePin(id)
        OfflineDownloadService.failed.remove(id)
        OfflineDownloadService.failedReason.remove(id)
        call.resolve(status()); notifyListeners("offline", status())
    }

    @PluginMethod fun cancel(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        OfflineDownloadService.cancel(context, id)
        store.removePin(id)
        call.resolve(status()); notifyListeners("offline", status())
    }

    @PluginMethod fun clearAll(call: PluginCall) {
        store.pins().forEach { OfflineDownloadService.cancelled.add(it.id) }
        store.clearAll(); OfflineDownloadService.failed.clear(); OfflineDownloadService.failedReason.clear()
        call.resolve(status()); notifyListeners("offline", status())
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
