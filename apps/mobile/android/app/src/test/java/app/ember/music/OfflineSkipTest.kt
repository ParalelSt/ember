package app.ember.music

import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.nio.file.Files
import java.time.Duration

/**
 * Offline, the native player skips songs that are not on the phone and
 * stops (flagged) when nothing ahead is; back online it reloads, paused.
 * A real ExoPlayer; which songs "are on the phone" is a set the test owns,
 * except in the last test, where it is the real cache after a real
 * network error.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflineSkipTest {
    private val app = RuntimeEnvironment.getApplication()
    /** Never answers: nothing in these tests may finish loading by accident. */
    private val server = MockWebServer().apply { repeat(20) { enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) } }
    private val base = server.url("/").toString().trimEnd('/')
    private val player = ExoPlayer.Builder(app).build()
    private val onPhone = HashSet<String>()
    private var online = false
    private val stalledEvents = ArrayList<Boolean>()
    private val guard = OfflinePlayback(player, { it.mediaId in onPhone }, { online }) { stalledEvents.add(it) }

    @After fun release() {
        player.release()
        runCatching { server.shutdown() }
    }

    private fun item(id: String) = TrackItems.toMediaItem(JSONObject("""{"id":"$id","title":"$id","artist":"X","streamUrl":"/s/$id"}"""), base)
    private fun queue(vararg ids: String) = ids.map(::item)
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()
    private val networkError = PlaybackException("down", null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)

    private fun start(vararg ids: String, at: Int = 0) {
        player.setMediaItems(queue(*ids), at, 0)
        player.playWhenReady = true
        idle()
        player.addListener(guard)
    }

    @Test fun `a network error offline skips to the next song on the phone`() {
        onPhone += "c"
        start("a", "b", "c", "d")
        guard.onPlayerError(networkError)
        idle()
        assertEquals(2, player.currentMediaItemIndex)
        assertTrue("keeps playing", player.playWhenReady)
        assertFalse(guard.stalled)
    }

    @Test fun `nothing ahead on the phone pauses and flags it`() {
        onPhone += "a"
        start("a", "b", "c", at = 1)
        guard.onPlayerError(networkError)
        idle()
        assertEquals(1, player.currentMediaItemIndex)
        assertFalse(player.playWhenReady)
        assertTrue(guard.stalled)
        assertEquals(listOf(true), stalledEvents)
    }

    @Test fun `loop all wraps to the start of the queue`() {
        onPhone += "a"
        start("a", "b", "c", at = 1)
        player.repeatMode = Player.REPEAT_MODE_ALL
        guard.onPlayerError(networkError)
        idle()
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test fun `loop one looks ahead instead of replaying a song that failed`() {
        onPhone += "c"
        start("a", "b", "c", at = 1)
        player.repeatMode = Player.REPEAT_MODE_ONE
        guard.onPlayerError(networkError)
        idle()
        assertEquals(2, player.currentMediaItemIndex)
    }

    @Test fun `online, an error is left alone`() {
        online = true
        onPhone += "c"
        start("a", "b", "c")
        guard.onPlayerError(networkError)
        idle()
        assertEquals(0, player.currentMediaItemIndex)
        assertFalse(guard.stalled)
    }

    @Test fun `an error that is not the network is left alone`() {
        onPhone += "c"
        start("a", "b", "c")
        guard.onPlayerError(PlaybackException("bad", null, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED))
        idle()
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test fun `offline, moving onto a song that is not on the phone skips it before it fails`() {
        onPhone += setOf("a", "d")
        start("a", "b", "c", "d")
        player.seekToNextMediaItem()
        idle()
        assertEquals(3, player.currentMediaItemIndex)
    }

    @Test fun `picking a song on the phone ends a stall`() {
        onPhone += "a"
        start("a", "b", "c", at = 1)
        guard.onPlayerError(networkError)
        idle()
        assertTrue(guard.stalled)
        player.seekTo(0, 0)
        idle()
        assertFalse(guard.stalled)
    }

    @Test fun `back online the stalled song loads again, paused`() {
        start("a", "b")
        guard.onPlayerError(networkError)
        idle()
        assertTrue(guard.stalled)
        assertEquals(Player.STATE_IDLE, player.playbackState)
        online = true
        guard.onNetwork(true)
        idle()
        assertFalse(guard.stalled)
        assertNotEquals(Player.STATE_IDLE, player.playbackState)
        assertFalse("never plays by itself", player.playWhenReady)
        assertEquals(listOf(true, false), stalledEvents)
    }

    @Test fun `the search follows the shuffle order`() {
        player.setMediaItems(queue("a", "b", "c", "d"))
        player.setShuffleOrder(ShuffleOrder.DefaultShuffleOrder(intArrayOf(0, 3, 1, 2), 0))
        player.shuffleModeEnabled = true
        idle()
        val tl = player.currentTimeline
        // Play order a, d, b, c: after a, the first on the phone of d, b, c.
        assertEquals(1, OfflinePlayback.nextOfflineIndex(tl, 0, Player.REPEAT_MODE_OFF, true) { it == 1 || it == 2 })
        assertEquals(3, OfflinePlayback.nextOfflineIndex(tl, 0, Player.REPEAT_MODE_OFF, true) { true })
        assertEquals(C.INDEX_UNSET, OfflinePlayback.nextOfflineIndex(tl, 2, Player.REPEAT_MODE_OFF, true) { true })
        assertEquals(0, OfflinePlayback.nextOfflineIndex(tl, 2, Player.REPEAT_MODE_ALL, true) { true })
        assertEquals(C.INDEX_UNSET, OfflinePlayback.nextOfflineIndex(tl, 2, Player.REPEAT_MODE_ALL, true) { false })
    }

    /** The whole path with real parts: the service's player, the real cache
     *  holding song b, a server that drops every connection, and "the phone
     *  is offline". Song a fails with a network error; the guard moves to b,
     *  which is then read from the cache (its bytes are not audio, so the
     *  player ends on a parsing error, on b, and the server never saw b). */
    @Test fun `a real network failure moves on to the cached song`() {
        val cache = MediaCache.create(Files.createTempDirectory("m3").toFile(), StandaloneDatabaseProvider(app))
        val songs = MockWebServer()
        try {
            val songsBase = songs.url("/").toString().trimEnd('/')
            val streams = MediaCache.dataSourceFactory(cache, OkHttpDataSource.Factory(OkHttpClient()))
            songs.enqueue(MockResponse().setBody("not audio at all, but cached"))
            AutoCacher.cacheWriterDownloads(streams).create("youtube:b", "$songsBase/s/b?prefetch=1").run()
            songs.takeRequest()
            repeat(30) { songs.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)) }
            val p = EmberPlaybackService.buildPlayer(app, streams, OfflineStore(Files.createTempDirectory("offline").toFile()))
            try {
                val real = OfflinePlayback(p, { MediaCache.isFullyCached(cache, it.mediaId) }, { false })
                p.addListener(real)
                fun track(id: String) = TrackItems.toMediaItem(JSONObject("""{"id":"youtube:$id","title":"$id","artist":"X","streamUrl":"/s/$id"}"""), songsBase)
                p.setMediaItems(listOf(track("a"), track("b")))
                p.prepare()
                p.play()
                val end = System.currentTimeMillis() + 15_000
                while (System.currentTimeMillis() < end) {
                    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
                    if (p.currentMediaItemIndex == 1 && p.playerError != null) break
                    Thread.sleep(5)
                }
                assertEquals(1, p.currentMediaItemIndex)
                assertEquals(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, p.playerError?.errorCode)
                assertFalse(real.stalled)
                val paths = generateSequence { songs.takeRequest(10, java.util.concurrent.TimeUnit.MILLISECONDS) }.map { it.path }.toList()
                assertTrue("b never went to the server: $paths", paths.none { it?.startsWith("/s/b") == true && !it.contains("prefetch") })
            } finally {
                p.release()
            }
        } finally {
            cache.release()
            songs.shutdown()
        }
    }
}
