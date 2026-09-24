package app.ember.music

import android.content.Context
import androidx.media3.common.C
import androidx.media3.database.DatabaseProvider
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/** The auto cache on Android: one Media3 SimpleCache, 300 MB, least recently
 *  used first out.
 *
 *  Read-through: every song the player streams lands in it as it plays, so
 *  the current song survives a dropped connection without a second download,
 *  and AutoCacher adds the next two with CacheWriter. Entries are keyed by the
 *  Ember track id (TrackItems sets it as the item's custom cache key), so the
 *  prefetch marker `?prefetch=1` in the URL never splits an entry. Pinned
 *  downloads stay in OfflineStore, which this never touches; a pinned song is
 *  read from its file before this cache is asked (OfflineAudio).
 *
 *  LRU is enough to honour "never evict the current track or the window":
 *  those three are always the most recently written or read entries, and a
 *  whole window is ~15 MB against a 300 MB cap. */
object MediaCache {
    const val CAP_BYTES = 300L shl 20

    @Volatile private var instance: SimpleCache? = null

    /** One per process: SimpleCache refuses a second instance on the same folder. */
    fun shared(context: Context): SimpleCache =
        instance ?: synchronized(this) {
            instance ?: create(File(context.cacheDir, "media3-audio"), StandaloneDatabaseProvider(context.applicationContext)).also { instance = it }
        }

    /** Tests only: Robolectric keeps statics between tests, each with a
     *  fresh cache folder. */
    internal fun releaseShared() = synchronized(this) {
        instance?.release()
        instance = null
    }

    fun create(dir: File, db: DatabaseProvider, cap: Long = CAP_BYTES): SimpleCache =
        SimpleCache(dir, LeastRecentlyUsedCacheEvictor(cap), db)

    /** Streams read through the cache. A broken cache entry falls back to the
     *  network rather than failing the song. */
    fun dataSourceFactory(cache: Cache, upstream: DataSource.Factory): CacheDataSource.Factory =
        CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(upstream)
            .setCacheKeyFactory { spec -> spec.key ?: spec.uri.toString() }
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

    /** Whole song on disk. The length is only known once a download has seen
     *  the response's end; until then the entry counts as partial. */
    fun isFullyCached(cache: Cache, key: String): Boolean {
        val len = runCatching { ContentMetadata.getContentLength(cache.getContentMetadata(key)) }.getOrDefault(C.LENGTH_UNSET.toLong())
        if (len == C.LENGTH_UNSET.toLong() || len <= 0) return false
        return runCatching { cache.isCached(key, 0, len) }.getOrDefault(false)
    }

    /** Bytes on disk per key, partial entries included. */
    fun sizes(cache: Cache): Map<String, Long> =
        runCatching { cache.keys.associateWith { cache.getCachedBytes(it, 0, C.LENGTH_UNSET.toLong()) } }.getOrDefault(emptyMap())

    /** Keys whose whole song is on disk. */
    fun fullyCached(cache: Cache): Set<String> =
        runCatching { cache.keys.filterTo(HashSet()) { isFullyCached(cache, it) } }.getOrDefault(emptySet())

    /** Empties the cache except `keep` (the song playing, whose spans the
     *  player may hold open). */
    fun clear(cache: Cache, keep: String?) {
        for (key in runCatching { cache.keys.toList() }.getOrDefault(emptyList())) {
            if (key != keep) runCatching { cache.removeResource(key) }
        }
    }
}
