package app.ember.music

import android.content.Context
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.Executor

/**
 * Volume normalization in the native player: each song plays at the
 * person's level times its own gain, the level changes when the song does
 * (the native player moves on by itself, in the car too), and the volume
 * slider never wipes the gain. A real (unprepared) ExoPlayer; the server's
 * answers are a map the test owns, except in the ServerApi test.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NormalizationTest {
    private val app = RuntimeEnvironment.getApplication()
    private val player = ExoPlayer.Builder(app).build()
    private val direct = Executor { it.run() }
    private val server = HashMap<String, Double>()
    private val asked = ArrayList<String>()
    private val prefs = app.getSharedPreferences("normalize-test", Context.MODE_PRIVATE).also { it.edit().clear().commit() }
    private val store = GainStore(prefs)
    private val normalizer = Normalizer(player, store, { asked.add(it); server[it] }, direct, direct)
    private val level = LevelPlayer(player, normalizer)

    @After fun release() = player.release()

    private val loud = "youtube:loudloudlou"
    private val quiet = "youtube:quietquietq"
    private val upload = "upload:u1"
    private fun item(id: String) = TrackItems.toMediaItem(JSONObject().put("id", id).put("streamUrl", "/s/$id"), "https://e")
    private fun near(expected: Float, actual: Float) = assertEquals(expected, actual, 1e-3f)

    @Test fun `dB to a multiplier, clamped like the server`() {
        near(1f, Loudness.dbToLinear(0.0))
        near(0.5012f, Loudness.dbToLinear(-6.0))
        near(Loudness.dbToLinear(-12.0), Loudness.dbToLinear(-40.0))
        near(Loudness.dbToLinear(6.0), Loudness.dbToLinear(20.0))
        near(1f, Loudness.dbToLinear(null))
        near(1f, Loudness.dbToLinear(Double.NaN))
        near(1f, Loudness.level(0.8f, 2f)) // never past full volume
    }

    @Test fun `each song plays at its own level, changing when the song does`() {
        server[loud] = -6.0
        server[quiet] = 3.0
        level.volume = 0.5f
        player.setMediaItems(listOf(item(loud), item(quiet)))
        near(0.5f * 0.5012f, player.volume)
        // The native player moves on by itself (auto-advance, the car's Next).
        player.seekTo(1, 0)
        near(0.5f * 1.4125f, player.volume)
        // The person's level is still what they set.
        near(0.5f, level.volume)
    }

    @Test fun `the slider moves the level without wiping the song's gain`() {
        server[loud] = -6.0
        player.setMediaItems(listOf(item(loud)))
        level.volume = 0.8f
        near(0.8f * 0.5012f, player.volume)
        level.volume = 0.2f
        near(0.2f * 0.5012f, player.volume)
    }

    @Test fun `off, or a song with no measurement, plays at the person's level`() {
        server[loud] = -6.0
        level.volume = 0.7f
        player.setMediaItems(listOf(item(upload), item(loud)))
        near(0.7f, player.volume)
        assertEquals(listOf(loud), asked) // an upload is never asked about; the next song is
        player.seekTo(1, 0)
        near(0.7f * 0.5012f, player.volume)
        normalizer.setEnabled(false)
        near(0.7f, player.volume)
        normalizer.setEnabled(true)
        near(0.7f * 0.5012f, player.volume)
    }

    @Test fun `a found gain is asked once and kept on disk, not measured yet is asked again`() {
        server[loud] = -6.0
        player.setMediaItems(listOf(item(loud), item(quiet)))
        player.seekTo(1, 0)
        player.seekTo(0, 0)
        assertEquals(1, asked.count { it == loud })
        assertEquals(true, asked.count { it == quiet } > 1) // null: asked again later
        assertEquals(-6.0, GainStore(prefs).get(loud)!!, 1e-9)
        assertNull(GainStore(prefs).get(quiet))
    }

    @Test fun `the prank duck composes with the gain`() {
        server[loud] = -6.0
        level.volume = 1f
        player.setMediaItems(listOf(item(loud)))
        val duck = OverlayDuck(0.3)
        player.volume = duck.start(player.volume)
        near(0.5012f * 0.3f, player.volume)
        player.volume = duck.base
        near(0.5012f, player.volume)
    }

    @Test fun `ServerApi reads the loudness route`() {
        val web = MockWebServer()
        try {
            web.enqueue(MockResponse().setBody("""{"gainDb":-4.5}"""))
            web.enqueue(MockResponse().setBody("""{"gainDb":null}"""))
            val api = ServerApi(web.url("/").toString().trimEnd('/')) { null }
            assertEquals(-4.5, api.trackGain(loud)!!, 1e-9)
            assertNull(api.trackGain(quiet))
            assertEquals("/api/tracks/youtube%3Aloudloudlou/loudness", web.takeRequest().path)
        } finally {
            web.shutdown()
        }
    }
}
