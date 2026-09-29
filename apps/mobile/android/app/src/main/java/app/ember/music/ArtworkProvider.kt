package app.ember.music

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.ParcelFileDescriptor
import android.util.Log
import android.webkit.CookieManager
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest

/** Covers the car can load by itself.
 *
 *  Android Auto, the car's media centre and the system media controls draw
 *  browse lists and the queue from each item's artwork URI, in their own
 *  process. A cover on the Ember server (an upload's /api/uploads/<id>/art,
 *  a playlist's picture) needs the member's cookie, which only Ember has, so
 *  those lists showed blank squares. Such a cover is handed out as
 *  content://<app>.artwork/... instead, and this provider fetches it with the
 *  cookie (ArtworkFetcher), keeps it on disk, and serves the file.
 *
 *  Any other cover (YouTube's, on Google's hosts) keeps its https address:
 *  the car loads those itself, and they never get the cookie. */
object ArtworkUris {
    const val UPLOAD = "upload"
    const val PLAYLIST = "playlist"
    const val TRACK = "track"

    private val UPLOAD_PATH = Regex("^/api/uploads/([A-Za-z0-9_-]{1,64})/art$")
    private val PLAYLIST_PATH = Regex("^/pb/api/files/playlists/([A-Za-z0-9_-]{1,64})/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$")
    /** A track id ("youtube:abc", "upload:rec1"); never only dots. */
    private val SAFE_ID = Regex("^(?!\\.+$)[A-Za-z0-9_:.-]{1,200}$")

    fun authority(packageName: String) = "$packageName.artwork"

    /** The server path of [art] when it is a cover on the Ember server, as
     *  a relative path or an absolute URL on [baseUrl]; null otherwise. */
    fun serverPath(art: String, baseUrl: String): String? {
        val path = when {
            art.startsWith("/") && !art.startsWith("//") -> art
            art.startsWith("$baseUrl/") -> art.removePrefix(baseUrl)
            else -> return null
        }
        return path.takeIf { UPLOAD_PATH.matches(it) || PLAYLIST_PATH.matches(it) }
    }

    /** content:// for a cover on the Ember server, null for any other. */
    fun contentUriFor(art: String, baseUrl: String, authority: String): Uri? {
        val path = serverPath(art, baseUrl) ?: return null
        UPLOAD_PATH.matchEntire(path)?.let { m ->
            return Uri.Builder().scheme("content").authority(authority).appendPath(UPLOAD).appendPath(m.groupValues[1]).build()
        }
        val m = PLAYLIST_PATH.matchEntire(path) ?: return null
        return Uri.Builder().scheme("content").authority(authority).appendPath(PLAYLIST).appendPath(m.groupValues[1]).appendPath(m.groupValues[2]).build()
    }

    /** A downloaded song's own cover (the offline copy), for lists shown
     *  while the phone has no network. */
    fun trackUri(trackId: String, authority: String): Uri =
        Uri.Builder().scheme("content").authority(authority).appendPath(TRACK).appendPath(trackId).build()

    /** What a content URI asks for: a server path to fetch, or a track id
     *  whose downloaded cover to serve. Anything else is not ours (null). */
    sealed interface Target {
        data class Server(val path: String) : Target
        data class Downloaded(val trackId: String) : Target
    }

    fun targetOf(uri: Uri): Target? {
        val seg = uri.pathSegments
        return when {
            seg.size == 2 && seg[0] == UPLOAD -> "/api/uploads/${seg[1]}/art".takeIf { UPLOAD_PATH.matches(it) }?.let { Target.Server(it) }
            seg.size == 3 && seg[0] == PLAYLIST -> "/pb/api/files/playlists/${seg[1]}/${seg[2]}".takeIf { PLAYLIST_PATH.matches(it) }?.let { Target.Server(it) }
            seg.size == 2 && seg[0] == TRACK && SAFE_ID.matches(seg[1]) -> Target.Downloaded(seg[1])
            else -> null
        }
    }
}

/** Fetches and keeps the covers ArtworkUris hands out. Only ever the Ember
 *  server's cover paths (ArtworkUris.targetOf), only images, at most 8 MB. */
class ArtworkFetcher(
    private val baseUrl: String,
    private val http: OkHttpClient,
    private val dir: File,
    private val downloadedArt: (String) -> File?,
    /** No network: the copy on disk, or nothing, at once. */
    private val online: () -> Boolean = { true },
) {
    companion object {
        const val MAX_BYTES = 8L * 1024 * 1024
        /** An upload's cover can be replaced; a week-old copy is fetched again. */
        const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
        /** Covers fetched at once. Each one holds a binder thread of the
         *  app's (the car asks from its process); the rest wait briefly, then
         *  make do with what is on disk, so the player's own binder calls
         *  (the car's buttons) always find a free thread. */
        const val MAX_FETCHES = 3
        const val WAIT_FOR_SLOT_MS = 2_000L

        /** The fetch client: [base]'s cookie handling, with short timeouts
         *  (a cover is not worth holding the car's list for). */
        fun client(base: OkHttpClient): OkHttpClient = base.newBuilder()
            .connectTimeout(4, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }

    private val slots = java.util.concurrent.Semaphore(MAX_FETCHES)

    private fun key(path: String): String =
        MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }

    /** The file to serve for [uri], or null when there is none. Blocks on
     *  the network: never on the main thread (ContentProvider.openFile runs
     *  on a binder thread). */
    fun fileFor(uri: Uri, now: Long = System.currentTimeMillis()): File? = when (val t = ArtworkUris.targetOf(uri)) {
        null -> null
        is ArtworkUris.Target.Downloaded -> downloadedArt(t.trackId)?.takeIf { it.isFile }
        is ArtworkUris.Target.Server -> serverFile(t.path, now)
    }

    private fun serverFile(path: String, now: Long): File? {
        val file = File(dir, key(path))
        if (file.isFile && file.length() > 0 && now - file.lastModified() < MAX_AGE_MS) return file
        val fetched = if (!online() || !slots.tryAcquire(WAIT_FOR_SLOT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)) null else try {
            runCatching { download(path, file) }
                .onFailure { Log.w(EmberPlaybackService.TAG, "car cover $path: ${it.message}") }
                .getOrNull()
        } finally {
            slots.release()
        }
        // Offline, or the server said no: an older copy beats a blank square.
        return fetched ?: file.takeIf { it.isFile && it.length() > 0 }
    }

    private fun download(path: String, dest: File): File? {
        http.newCall(Request.Builder().url(baseUrl + path).build()).execute().use { res ->
            if (!res.isSuccessful) return null
            val body = res.body ?: return null
            val type = body.contentType()
            if (type == null || type.type != "image") return null
            if (body.contentLength() > MAX_BYTES) return null
            dir.mkdirs()
            // One part file per fetch: the car asks for a whole list's covers
            // at once, and two fetches of one cover must not share it.
            val tmp = File.createTempFile(dest.name, ".part", dir)
            try {
                var total = 0L
                body.byteStream().use { input ->
                    tmp.outputStream().use { out ->
                        val buf = ByteArray(16 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > MAX_BYTES) return null
                            out.write(buf, 0, n)
                        }
                    }
                }
                if (total == 0L) return null
                if (!tmp.renameTo(dest)) { dest.delete(); if (!tmp.renameTo(dest)) return null }
                return dest
            } finally {
                // Whatever did not become the cover (too big, empty, failed).
                if (tmp.exists()) tmp.delete()
            }
        }
    }
}

/** Serves ArtworkUris' content URIs. Exported, because the car and the
 *  system read it from their own processes, but it answers only the callers
 *  the player service lets in (ControllerPolicy: Ember, the system, Android
 *  Auto, the car's media centre, SystemUI), only for the cover paths above,
 *  and only for reading. */
class ArtworkProvider : ContentProvider() {
    private val gate by lazy { ControllerGate(context!!) }
    private val fetcher by lazy {
        val ctx = context!!
        val baseUrl = ServerConfig.baseUrl(ctx)
        val api = ServerApi(baseUrl) { runCatching { CookieManager.getInstance().getCookie(baseUrl) }.getOrNull() }
        val offline = OfflineStore.shared(ctx)
        val net = NetworkWatch(ctx) {}
        ArtworkFetcher(baseUrl, ArtworkFetcher.client(api.http), File(ctx.cacheDir, "car-art"), { id -> offline.artFileFor(id) }) { net.current().online }
    }

    override fun onCreate(): Boolean {
        // Runs as the process starts, before any broadcast receiver.
        EmberMediaButtonReceiver.appContext = context?.applicationContext
        return true
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read only")
        val uid = Binder.getCallingUid()
        val pkg = callingPackage ?: context?.packageManager?.getNameForUid(uid) ?: ""
        val verdict = gate.verdict(pkg, uid, trustedForMediaControl = false)
        if (!verdict.allowed) {
            Log.w(EmberPlaybackService.TAG, "car cover refused for $pkg uid=$uid ($verdict)")
            throw SecurityException("not allowed")
        }
        val file = fetcher.fileFor(uri) ?: throw FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String? = if (ArtworkUris.targetOf(uri) != null) "image/*" else null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
}
