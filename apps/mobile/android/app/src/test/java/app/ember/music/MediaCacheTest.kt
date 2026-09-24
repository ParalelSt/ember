package app.ember.music

import android.os.Looper
import androidx.media3.common.PlaybackException
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.nio.file.Files
import java.time.Duration

/**
 * The real pieces end to end: CacheWriter through the player's own cache
 * stack against a fake server, then the service's player reading the song
 * back from the cache with the server gone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MediaCacheTest {
    private val app = RuntimeEnvironment.getApplication()
    private val server = MockWebServer()
    private val base = server.url("/").toString().trimEnd('/')
    private val cache: SimpleCache = MediaCache.create(Files.createTempDirectory("m3").toFile(), StandaloneDatabaseProvider(app))
    private val streams = MediaCache.dataSourceFactory(cache, OkHttpDataSource.Factory(OkHttpClient()))
    private val downloads = AutoCacher.cacheWriterDownloads(streams)
    private val body = ByteArray(40_000) { (it % 251).toByte() }
    private var player: ExoPlayer? = null

    @After fun release() {
        player?.release()
        cache.release()
        runCatching { server.shutdown() }
    }

    private fun song(): MockResponse = MockResponse().setBody(okio.Buffer().write(body)).setHeader("Content-Type", "audio/mp4")

    @Test fun `a prefetch lands whole in the cache under the track id`() {
        server.enqueue(song())
        val url = AutoCacher.prefetchUrl("$base/api/youtube/stream/c")
        val bytes = downloads.create("youtube:c", url).run()
        assertEquals("/api/youtube/stream/c?prefetch=1", server.takeRequest().path)
        assertEquals(body.size.toLong(), bytes)
        assertTrue(MediaCache.isFullyCached(cache, "youtube:c"))
        assertEquals(setOf("youtube:c"), MediaCache.fullyCached(cache))
        assertEquals(mapOf("youtube:c" to body.size.toLong()), MediaCache.sizes(cache))
    }

    @Test fun `a busy host's 503 comes back as a backoff with its Retry-After`() {
        server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "30").setBody("{\"error\":\"busy\"}"))
        try {
            downloads.create("youtube:c", "$base/api/youtube/stream/c?prefetch=1").run()
            fail("expected a 503")
        } catch (e: Exception) {
            assertEquals(AutoCachePolicy.Result.RetryAfter(503, 30.0), AutoCacher.classify(e))
        }
        assertFalse(MediaCache.isFullyCached(cache, "youtube:c"))
    }

    @Test fun `a 410 comes back as gone`() {
        server.enqueue(MockResponse().setResponseCode(410))
        try {
            downloads.create("youtube:c", "$base/api/youtube/stream/c?prefetch=1").run()
            fail("expected a 410")
        } catch (e: Exception) {
            assertEquals(AutoCachePolicy.Result.Gone, AutoCacher.classify(e))
        }
    }

    @Test fun `a cut-off download is partial, not cached`() {
        server.enqueue(song().setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY))
        runCatching { downloads.create("youtube:c", "$base/api/youtube/stream/c?prefetch=1").run() }
        assertFalse(MediaCache.isFullyCached(cache, "youtube:c"))
        assertFalse(MediaCache.isFullyCached(cache, "youtube:never"))
    }

    @Test fun `clearing keeps only the playing song`() {
        server.enqueue(song()); server.enqueue(song())
        downloads.create("youtube:c", "$base/c").run()
        downloads.create("youtube:d", "$base/d").run()
        MediaCache.clear(cache, keep = "youtube:d")
        assertEquals(setOf("youtube:d"), MediaCache.fullyCached(cache))
    }

    /** The player finds the prefetched song by its id with the server gone.
     *  The bytes are not audio, so it fails parsing them: proof it read the
     *  cache instead of the network (which would be a network error). */
    @Test fun `the player reads a prefetched song from the cache`() {
        server.enqueue(song())
        downloads.create("youtube:c", AutoCacher.prefetchUrl("$base/api/youtube/stream/c")).run()
        server.shutdown()
        val p = EmberPlaybackService.buildPlayer(app, streams, OfflineStore(Files.createTempDirectory("offline").toFile()))
        player = p
        val track = JSONObject("""{"id":"youtube:c","title":"C","artist":"X","streamUrl":"/api/youtube/stream/c"}""")
        p.setMediaItem(TrackItems.toMediaItem(track, base))
        p.prepare()
        p.play()
        val end = System.currentTimeMillis() + 3_000
        while (p.playerError == null && System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            Thread.sleep(5)
        }
        assertEquals(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, p.playerError?.errorCode)
    }
}
