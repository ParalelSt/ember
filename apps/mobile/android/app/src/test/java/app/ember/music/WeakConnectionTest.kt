package app.ember.music

import android.os.Handler
import android.os.Looper
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 * The 2026-10 report: mobile data stopped getting anything through while
 * Android still called the network online (validated), and the music
 * stopped instead of playing the songs already on the phone.
 *
 * Here the network is "online" throughout, as Android saw it. The server
 * takes the song's request and never answers (a connection that carries
 * nothing), and the probe gets no answer either. The service's own player,
 * a real ExoPlayer under Robolectric, with the offline rules and the
 * connection check wired as the service wires them.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WeakConnectionTest {
    private val app = RuntimeEnvironment.getApplication()
    private val handler = Handler(Looper.getMainLooper())
    private val later: (Long, Runnable) -> () -> Unit = { ms, task ->
        handler.postDelayed(task, ms)
        ({ handler.removeCallbacks(task) })
    }

    /** Takes every request and never answers; records what was asked for. */
    private val asked = ArrayList<String>()
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(asked) { asked.add(request.path.orEmpty()) }
                return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            }
        }
    }
    private val base = server.url("/").toString().trimEnd('/')
    private val players = ArrayList<ExoPlayer>()

    @After fun release() {
        players.forEach { it.release() }
        runCatching { server.shutdown() }
    }

    private fun track(id: String) = TrackItems.toMediaItem(JSONObject("""{"id":"$id","title":"$id","artist":"X","streamUrl":"/s/$id"}"""), base)
    private fun askedFor(id: String) = synchronized(asked) { asked.count { it.startsWith("/s/$id") } }

    /** Emulated time for the main thread, a little real time for the
     *  player's own. */
    private fun runFor(ms: Long, done: () -> Boolean = { false }): Boolean {
        var left = ms
        while (left > 0) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            left -= 100
            Thread.sleep(3)
            if (done()) return true
        }
        return false
    }

    private fun player(streams: androidx.media3.datasource.DataSource.Factory = OkHttpDataSource.Factory(OkHttpClient())) =
        EmberPlaybackService.buildPlayer(app, streams, OfflineStore(Files.createTempDirectory("weak").toFile())).also { players.add(it) }

    /** The service's wiring: the rules ask ConnectionHealth when a song is
     *  stuck, and hear back through onNetwork. */
    private class Wired(
        player: Player,
        onPhone: (String) -> Boolean,
        later: (Long, Runnable) -> () -> Unit,
        main: (Runnable) -> Unit,
        var validated: Boolean = true,
        val answers: ArrayDeque<Boolean> = ArrayDeque(),
    ) {
        var probes = 0
        lateinit var rules: OfflinePlayback
        val health: ConnectionHealth = ConnectionHealth(
            probe = { probes++; answers.removeFirstOrNull() ?: false },
            io = { it.run() },
            main = main,
            later = later,
            clock = android.os.SystemClock::elapsedRealtime,
        ) { rules.onNetwork(online()) }
        fun online(): Boolean = validated && !health.down
        init {
            rules = OfflinePlayback(player, { onPhone(it.mediaId) }, ::online, later = later, onStuck = health::suspect)
            player.addListener(rules)
        }
    }

    private fun wire(p: Player, onPhone: Set<String>) = Wired(p, { it in onPhone }, later, { handler.post(it) })

    private fun play(p: Player, vararg ids: String) {
        p.setMediaItems(ids.map(::track))
        p.prepare()
        p.play()
    }

    @Test fun `a song stuck on a dead connection moves on to the next song on the phone, past one that is not`() {
        val p = player()
        val w = wire(p, setOf("c"))
        play(p, "a", "b", "c")
        runFor(OfflinePlayback.STUCK_MS - 1_000)
        assertEquals("a slow start is not a dead connection yet", 0, p.currentMediaItemIndex)
        assertEquals(0, w.probes)
        runFor(3_000) { p.currentMediaItemIndex == 2 }
        assertEquals(1, w.probes)
        assertTrue(w.health.down)
        assertEquals(2, p.currentMediaItemIndex)
        assertTrue("still playing", p.playWhenReady)
        assertFalse(w.rules.stalled)
        assertEquals("b was never asked for", 0, askedFor("b"))
    }

    @Test fun `a server that answers is a slow song, not a dead connection, and it stays`() {
        val p = player()
        val w = wire(p, setOf("c"))
        repeat(10) { w.answers.add(true) }
        play(p, "a", "b", "c")
        runFor(40_000)
        assertEquals(0, p.currentMediaItemIndex)
        assertFalse(w.health.down)
        assertTrue("asked again while it stayed stuck", w.probes >= 2)
        assertEquals(Player.STATE_BUFFERING, p.playbackState)
    }

    @Test fun `nothing on the phone ahead waits on the song, then goes on by itself when the connection is back`() {
        val p = player()
        val w = wire(p, emptySet())
        w.answers.addAll(listOf(false, true))
        play(p, "a", "b")
        runFor(OfflinePlayback.STUCK_MS + 1_000) { w.rules.stalled }
        assertTrue(w.rules.stalled)
        assertEquals(0, p.currentMediaItemIndex)
        assertTrue("play left on", p.playWhenReady)
        assertEquals(Player.STATE_BUFFERING, p.playbackState)
        val before = askedFor("a")
        // The next look finds the server: the song is tried again at once,
        // not after the player's own wait.
        runFor(ConnectionHealth.RETRY_MS + 500) { !w.rules.stalled }
        assertFalse(w.rules.stalled)
        assertFalse(w.health.down)
        runFor(1_000) { askedFor("a") > before }
        assertTrue("asked for a again", askedFor("a") > before)
        assertEquals(0, p.currentMediaItemIndex)
        assertTrue(p.playWhenReady)
    }

    @Test fun `with no network at all, a song left waiting moves on at once`() {
        val p = player()
        val w = wire(p, setOf("b"))
        play(p, "a", "b")
        runFor(1_000)
        assertEquals(0, p.currentMediaItemIndex)
        w.validated = false
        w.rules.onNetwork(false)
        runFor(200)
        assertEquals(1, p.currentMediaItemIndex)
        assertEquals("nothing to ask: Android says there is no network", 0, w.probes)
    }

    @Test fun `a paused song waiting on the network is left alone`() {
        val p = player()
        val w = wire(p, setOf("b"))
        p.setMediaItems(listOf(track("a"), track("b")))
        p.prepare()
        runFor(3 * OfflinePlayback.STUCK_MS)
        assertEquals(0, w.probes)
        assertEquals(0, p.currentMediaItemIndex)
    }

    /** The whole path with real parts: the real cache holding song b, a
     *  server that takes a's request and never answers, the network
     *  "validated" throughout. The player moves to b, which is read from the
     *  cache (its bytes are not audio, so the player ends on a parsing error,
     *  on b), and b is never asked of the server. Before, it stayed on a. */
    @Test fun `the reported case - a validated network carrying nothing plays the cached song`() {
        val cache = MediaCache.create(Files.createTempDirectory("m3").toFile(), StandaloneDatabaseProvider(app))
        val songs = MockWebServer()
        try {
            val songsBase = songs.url("/").toString().trimEnd('/')
            val streams = MediaCache.dataSourceFactory(cache, OkHttpDataSource.Factory(OkHttpClient()))
            songs.enqueue(MockResponse().setBody("not audio at all, but cached"))
            AutoCacher.cacheWriterDownloads(streams).create("youtube:b", "$songsBase/s/b?prefetch=1").run()
            songs.takeRequest()
            repeat(30) { songs.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) }
            val p = player(streams)
            val w = Wired(p, { MediaCache.isFullyCached(cache, it) }, later, { handler.post(it) })
            fun cached(id: String) = TrackItems.toMediaItem(JSONObject("""{"id":"youtube:$id","title":"$id","artist":"X","streamUrl":"/s/$id"}"""), songsBase)
            p.setMediaItems(listOf(cached("a"), cached("b")))
            p.prepare()
            p.play()
            runFor(30_000) { p.currentMediaItemIndex == 1 && p.playerError != null }
            assertEquals(1, p.currentMediaItemIndex)
            assertEquals(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, p.playerError?.errorCode)
            assertTrue(w.health.down)
            val paths = generateSequence { songs.takeRequest(10, java.util.concurrent.TimeUnit.MILLISECONDS) }.map { it.path }.toList()
            assertTrue("b never went to the server: $paths", paths.none { it?.startsWith("/s/b") == true })
        } finally {
            cache.release()
            songs.shutdown()
        }
    }
}
