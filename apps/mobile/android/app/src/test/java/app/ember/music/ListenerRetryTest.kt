package app.ember.music

import android.net.Uri
import android.os.Bundle
import android.os.Looper
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.nio.file.Files
import java.time.Duration

/**
 * "Tap to retry" on the Android player. The host remembers a song that failed
 * for a passing reason for two minutes and answers the player's own tries
 * from that memory; only a load marked `retry=1` gets a real attempt. The
 * retry used to be a plain play of the same address, so it failed again.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ListenerRetryTest {
    private val app = RuntimeEnvironment.getApplication()
    private val server = MockWebServer()
    /** Every path asked for, query included. */
    private val asked = ArrayList<String>()
    private val retry = ListenerRetry()
    private var player: ExoPlayer? = null
    private var service: ServiceController<EmberPlaybackService>? = null

    init {
        // A song that would not load right now: the host's quick refusal.
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(asked) { asked.add(request.path.orEmpty()) }
                return MockResponse().setResponseCode(404).setBody("""{"error":"could not be loaded"}""")
            }
        }
    }

    @After fun tearDown() {
        player?.release()
        service?.destroy()
        MediaCache.releaseShared()
        runCatching { server.shutdown() }
    }

    private fun requests(): List<String> = synchronized(asked) { asked.toList() }

    private fun runUntil(ms: Long = 10_000, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            if (done()) return true
            Thread.sleep(5)
        }
        return false
    }

    private fun song(id: String, query: String = "") = TrackItems.toMediaItem(
        JSONObject().put("id", "youtube:$id").put("title", id).put("artist", "X").put("streamUrl", "/api/youtube/stream/$id$query"),
        server.url("/").toString().trimEnd('/'),
    )

    private fun phonePlayer(): ExoPlayer =
        EmberPlaybackService.buildPlayer(
            app, OkHttpDataSource.Factory(OkHttpClient()), OfflineStore(Files.createTempDirectory("retry").toFile()), retry = retry,
        ).also { player = it }

    /** Plays [items] from the first and waits for it to fail. */
    private fun failFirst(p: Player, vararg items: androidx.media3.common.MediaItem) {
        p.setMediaItems(items.toList())
        p.prepare()
        p.play()
        assertTrue("the song fails", runUntil { p.playerError != null })
    }

    /** Waits for the next load after [before] requests. */
    private fun nextLoad(before: Int): String {
        assertTrue("the song is asked for again", runUntil { requests().size > before })
        return requests()[before]
    }

    @Test fun `the mark goes after the address, or after a query it already has`() {
        assertEquals("https://h/api/youtube/stream/abc?retry=1", ListenerRetry.marked(Uri.parse("https://h/api/youtube/stream/abc")).toString())
        assertEquals("https://h/api/youtube/stream/abc?q=1&retry=1", ListenerRetry.marked(Uri.parse("https://h/api/youtube/stream/abc?q=1")).toString())
        // Never twice.
        assertEquals("https://h/api/youtube/stream/abc?retry=1", ListenerRetry.marked(Uri.parse("https://h/api/youtube/stream/abc?retry=1")).toString())
        // Nothing else knows it: an upload, a downloaded copy.
        assertEquals("https://h/api/uploads/u1/stream", ListenerRetry.marked(Uri.parse("https://h/api/uploads/u1/stream")).toString())
        assertEquals("file:///data/x/api/youtube/stream/abc", ListenerRetry.marked(Uri.parse("file:///data/x/api/youtube/stream/abc")).toString())
    }

    @Test fun `tap to retry reloads the failed song with the retry mark`() {
        val p = phonePlayer()
        failFirst(p, song("glitchy0001"))
        assertTrue(requests().none { it.contains("retry=") })
        val before = requests().size
        retry.retry(p)
        assertEquals("/api/youtube/stream/glitchy0001?retry=1", nextLoad(before))
    }

    @Test fun `a stream address that already has a query gets the mark after it`() {
        val p = phonePlayer()
        failFirst(p, song("glitchy0001", "?client=android"))
        val before = requests().size
        retry.retry(p)
        assertEquals("/api/youtube/stream/glitchy0001?client=android&retry=1", nextLoad(before))
    }

    @Test fun `a plain play after a failure (the car, a headset) carries no mark`() {
        val p = phonePlayer()
        failFirst(p, song("glitchy0001"))
        val before = requests().size
        p.prepare()
        p.play()
        assertEquals("/api/youtube/stream/glitchy0001", nextLoad(before))
    }

    @Test fun `the mark does not stay on the song once the player moves on`() {
        val p = phonePlayer()
        failFirst(p, song("glitchy0001"), song("other00001"))
        var before = requests().size
        retry.retry(p)
        assertEquals("/api/youtube/stream/glitchy0001?retry=1", nextLoad(before))
        assertTrue(runUntil { p.playerError != null })
        // On to the next song, and back: ordinary loads again.
        before = requests().size
        p.seekToNextMediaItem()
        p.prepare()
        assertEquals("/api/youtube/stream/other00001", nextLoad(before))
        assertTrue(runUntil { p.playerError != null })
        before = requests().size
        p.seekTo(0, 0)
        p.prepare()
        assertEquals("/api/youtube/stream/glitchy0001", nextLoad(before))
    }

    @Test fun `a retry while nothing failed is a plain play`() {
        val p = phonePlayer()
        p.setMediaItems(listOf(song("fine000001")))
        p.prepare()
        retry.retry(p)
        assertTrue(runUntil { requests().isNotEmpty() })
        assertTrue(p.playWhenReady)
        assertFalse(requests().any { it.contains("retry=") })
    }

    /** The app's retry reaches the service as COMMAND_RETRY (the plugin's
     *  retry method), from the app only. */
    @Test fun `the service's retry command reloads the failed song with the mark`() {
        val c = Robolectric.buildService(EmberPlaybackService::class.java).create().also { service = it }
        val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, 0, 0, 0, false, Bundle.EMPTY)
        val session = c.get().onGetSession(own)!!
        failFirst(session.player, song("glitchy0001"))
        val before = requests().size
        c.get().Callback().onCustomCommand(session, own, SessionCommand(EmberPlaybackService.COMMAND_RETRY, Bundle.EMPTY), Bundle.EMPTY)
        assertEquals("/api/youtube/stream/glitchy0001?retry=1", nextLoad(before))
    }
}
