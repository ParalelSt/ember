package app.ember.music

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** What is on the phone for offline playback: an index plus the files.
 *
 *  Pins (a playlist or Liked) list track ids; track files are shared between
 *  pins and deleted only when no pin references them. The index is written
 *  atomically (write beside, rename over), so a crash mid-download can lose
 *  at most the file being written, never the index. The download service, the
 *  Capacitor plugin and the native player all read this layout, so keep it. */
class OfflineStore(private val root: File) {
    companion object {
        @Volatile private var instance: OfflineStore? = null
        /** One store per process: the plugin and the download service must see
         *  the same in-memory index, or a pin made from the WebView would be
         *  invisible to the service that has to download it. */
        fun shared(context: android.content.Context): OfflineStore =
            instance ?: synchronized(this) { instance ?: OfflineStore(java.io.File(context.filesDir, "offline")).also { instance = it } }
    }

    data class Pin(val id: String, val name: String, val trackIds: List<String>, val updatedAt: Long)
    data class TrackFile(val id: String, val track: JSONObject, val audio: File?, val art: File?, val bytesAudio: Long, val bytesArt: Long)

    private val indexFile = File(root, "index.json")
    private val audioDir = File(root, "audio")
    private val artDir = File(root, "art")
    // Insertion order matters: pending() hands the downloader work in pin order.
    private val pins = LinkedHashMap<String, Pin>()
    private val tracks = LinkedHashMap<String, JSONObject>()

    init {
        audioDir.mkdirs(); artDir.mkdirs()
        // A half-written or hand-edited index must not brick the app; an
        // unreadable one just means "nothing pinned yet".
        if (indexFile.exists()) runCatching { load(JSONObject(indexFile.readText())) }
    }

    /** Track ids carry ':' and '/' ("upload:ab-c/1"). Every character outside
     *  the safe set becomes '_' rather than being dropped, so two different
     *  ids cannot collapse onto the same file name. */
    fun safeId(id: String): String = id.replace(Regex("[^A-Za-z0-9_-]"), "_")
    fun audioFileFor(id: String): File = File(audioDir, safeId(id) + ".m4a")
    fun artFileFor(id: String): File = File(artDir, safeId(id) + ".jpg")

    @Synchronized fun pins(): List<Pin> = pins.values.toList()

    @Synchronized fun upsertPin(id: String, name: String, list: List<JSONObject>) {
        val ids = list.map { it.getString("id") }
        list.forEach { tracks[it.getString("id")] = it }
        pins[id] = Pin(id, name, ids, System.currentTimeMillis())
        prune(); save()
    }

    @Synchronized fun removePin(id: String) { pins.remove(id); prune(); save() }

    /** Tracks that still need their audio, in pin order, once each. */
    @Synchronized fun pending(): List<Pair<String, JSONObject>> {
        val seen = HashSet<String>()
        return pins.values.flatMap { pin -> pin.trackIds.mapNotNull { tid ->
            if (!seen.add(tid) || audioFileFor(tid).exists()) null else tracks[tid]?.let { pin.id to it }
        } }
    }

    /** A download that finishes after its pin was removed must not resurrect
     *  the file: prune() already ran, so nothing would ever delete it again.
     *  Drop the temp file instead. */
    @Synchronized fun commitAudio(trackId: String, tmp: File) {
        if (trackId !in tracks) { tmp.delete(); return }
        move(tmp, audioFileFor(trackId))
    }

    @Synchronized fun commitArt(trackId: String, tmp: File) {
        if (trackId !in tracks) { tmp.delete(); return }
        move(tmp, artFileFor(trackId))
    }

    @Synchronized fun trackFiles(): Map<String, File> =
        tracks.keys.mapNotNull { id -> audioFileFor(id).takeIf { it.exists() }?.let { id to it } }.toMap()

    /** Artwork is best effort, so this is a subset of trackFiles(): a track can
     *  have audio and no art. Separate from trackFiles() rather than folded in
     *  so the web side can keep treating a trackFiles entry as "playable". */
    @Synchronized fun artFiles(): Map<String, File> =
        tracks.keys.mapNotNull { id -> artFileFor(id).takeIf { it.exists() }?.let { id to it } }.toMap()

    @Synchronized fun track(id: String): JSONObject? = tracks[id]

    @Synchronized fun totalBytes(): Long = tracks.keys.sumOf { audioFileFor(it).length() + artFileFor(it).length() }

    /** Drop every pin and let prune() delete the files that leaves unreferenced.
     *  Clearing `tracks` first would leave prune() nothing to iterate, so every
     *  downloaded file would stay on disk with no index left to find it by. */
    @Synchronized fun clearAll() { pins.clear(); prune(); save() }

    /** Progress per pin for the UI: how many of its tracks have audio. */
    @Synchronized fun progress(pin: Pin): Pair<Int, Int> = pin.trackIds.count { audioFileFor(it).exists() } to pin.trackIds.size

    private fun move(tmp: File, dest: File) {
        dest.delete()
        // renameTo fails across filesystems (a temp dir on another mount);
        // fall back to a copy so a download is never lost to that.
        if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true); tmp.delete() }
    }

    /** Drop files (and track JSON) that no pin references. */
    private fun prune() {
        val referenced = pins.values.flatMap { it.trackIds }.toSet()
        for (id in tracks.keys.toList()) if (id !in referenced) { audioFileFor(id).delete(); artFileFor(id).delete(); tracks.remove(id) }
    }

    private fun save() {
        val json = JSONObject()
            .put("pins", JSONArray(pins.values.map { p -> JSONObject().put("id", p.id).put("name", p.name).put("trackIds", JSONArray(p.trackIds)).put("updatedAt", p.updatedAt) }))
            .put("tracks", JSONArray(tracks.values.toList()))
        val tmp = File(root, "index.json.tmp")
        tmp.writeText(json.toString())
        if (!tmp.renameTo(indexFile)) { tmp.copyTo(indexFile, overwrite = true); tmp.delete() }
    }

    private fun load(json: JSONObject) {
        val ts = json.optJSONArray("tracks") ?: JSONArray()
        for (i in 0 until ts.length()) ts.getJSONObject(i).let { tracks[it.getString("id")] = it }
        val ps = json.optJSONArray("pins") ?: JSONArray()
        for (i in 0 until ps.length()) {
            val p = ps.getJSONObject(i); val ids = p.getJSONArray("trackIds")
            pins[p.getString("id")] = Pin(p.getString("id"), p.optString("name"), (0 until ids.length()).map { ids.getString(it) }, p.optLong("updatedAt"))
        }
    }
}
