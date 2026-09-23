package app.ember.music

import android.os.Looper
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.time.Duration
import java.util.concurrent.TimeUnit

/**
 * A downloaded song plays from the phone, not the network: offline that is
 * the difference between music and silence. The service's own player, real
 * ExoPlayer under Robolectric; the "download" is a file that is not audio,
 * so reading it fails in a way only reading that file can.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflinePlaybackTest {
    private val app = RuntimeEnvironment.getApplication()
    private val server = MockWebServer().apply {
        repeat(3) { enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) }
    }
    private val base = server.url("/").toString().trimEnd('/')
    private val store = OfflineStore(Files.createTempDirectory("offline").toFile())
    private val player = EmberPlaybackService.buildPlayer(app, OkHttpDataSource.Factory(OkHttpClient()), store)
    private val track = JSONObject("""{"id":"youtube:a","title":"A","artist":"X","streamUrl":"/api/youtube/stream/a"}""")

    @After fun release() {
        player.release()
        server.shutdown()
    }

    private fun download() {
        store.upsertPin("p1", "Road", listOf(track))
        store.commitAudio("youtube:a", File.createTempFile("aud", ".m4a").apply { writeText("not audio") })
    }

    private fun play() {
        player.setMediaItem(TrackItems.toMediaItem(track, base))
        player.prepare()
        player.play()
    }

    private fun runUntil(ms: Long = 3_000, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            if (done()) return true
            Thread.sleep(5)
        }
        return false
    }

    @Test fun `a downloaded song is read from the phone`() {
        download()
        play()
        runUntil { player.playerError != null }
        assertEquals("the server was not asked", 0, server.requestCount)
        assertEquals(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, player.playerError?.errorCode)
    }

    @Test fun `a song that is not downloaded streams`() {
        play()
        assertEquals("/api/youtube/stream/a", server.takeRequest(3, TimeUnit.SECONDS)?.path)
        assertNull(player.playerError)
    }

    /** Removing the download before the song starts: back to streaming. */
    @Test fun `a removed download streams again`() {
        download()
        store.removePin("p1")
        play()
        assertEquals("/api/youtube/stream/a", server.takeRequest(3, TimeUnit.SECONDS)?.path)
    }

    /** A seek reopens the song further in. It has to read the same bytes the
     *  song started with, even if the download appeared or went meanwhile. */
    @Test fun `a seek keeps reading what the song started with`() {
        val resolver = OfflineAudio.LocalFirst(store)
        fun open(at: Long) = resolver.resolveDataSpec(
            DataSpec.Builder().setUri("$base/api/youtube/stream/a").setKey("youtube:a").setPosition(at).build(),
        ).uri.scheme
        assertEquals("http", open(0))
        download()
        assertEquals("http", open(500_000))
        assertEquals("file", open(0))
        store.removePin("p1")
        assertEquals("file", open(500_000))
        assertEquals("http", open(0))
    }
}
