package app.ember.music

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

    override fun load() {
        OfflineDownloadService.listener = { progress -> notifyListeners("offline", status(progress)) }
    }

    private fun status(progress: JSONObject? = OfflineDownloadService.current): JSObject {
        val pins = JSArray()
        for (p in store.pins()) {
            val (done, total) = store.progress(p)
            pins.put(JSObject().put("id", p.id).put("name", p.name).put("total", total).put("done", done)
                .put("failed", OfflineDownloadService.failed[p.id]?.size ?: 0)
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
        store.upsertPin(id, name, tracks)
        OfflineDownloadService.start(context)
        call.resolve(status())
    }

    @PluginMethod fun unpin(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        OfflineDownloadService.cancelled.add(id)
        store.removePin(id)
        OfflineDownloadService.failed.remove(id)
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
        store.clearAll(); OfflineDownloadService.failed.clear()
        call.resolve(status()); notifyListeners("offline", status())
    }
}
