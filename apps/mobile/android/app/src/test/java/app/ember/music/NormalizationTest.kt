package app.ember.music

import android.content.Context
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
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
        near(0.6310f, Loudness.dbToLinear(-4.0))
        // Never more than a few dB down, whatever arrives.
        near(Loudness.dbToLinear(-5.0), Loudness.dbToLinear(-12.0))
        near(Loudness.dbToLinear(6.0), Loudness.dbToLinear(20.0))
        near(1f, Loudness.dbToLinear(null))
        near(1f, Loudness.dbToLinear(Double.NaN))
    }

    @Test fun `past full volume the booster takes over, or it stops at full volume`() {
        assertEquals(Loudness.Level(1f, 1f), Loudness.level(0.8f, 2f)) // no booster
        val boosted = Loudness.level(0.8f, 2f, canBoost = true)
        near(1f, boosted.volume)
        near(1.6f, boosted.boost)
        // Room left under the slider: all volume, no boost.
        val room = Loudness.level(0.4f, 2f, canBoost = true)
        near(0.8f, room.volume)
        near(1f, room.boost)
        // A cut is only ever volume.
        assertEquals(Loudness.Level(0.25f, 1f), Loudness.level(0.5f, 0.5f, canBoost = true))
    }

    @Test fun `a fade is even in dB and lands on its target`() {
        near(1f, Loudness.rampAt(1f, 0.5f, 0, 400))
        near(0.7071f, Loudness.rampAt(1f, 0.5f, 200, 400))
        near(0.5f, Loudness.rampAt(1f, 0.5f, 400, 400))
        near(0.5f, Loudness.rampAt(1f, 0.5f, 5000, 400))
        near(2f, Loudness.rampAt(1f, 2f, 0, 0))
    }

    @Test fun `the enhancer takes millibels, and nothing at all for no boost`() {
        assertEquals(0, LoudnessBooster.millibels(1f))
        assertEquals(0, LoudnessBooster.millibels(0.5f))
        assertEquals(0, LoudnessBooster.millibels(Float.NaN))
        assertEquals(300, LoudnessBooster.millibels(1.4125f))
        assertEquals(600, LoudnessBooster.millibels(4f)) // never past +6 dB
    }

    @Test fun `each song plays at its own level, changing when the song does`() {
        server[loud] = -6.0
        server[quiet] = 3.0
        level.volume = 0.5f
        player.setMediaItems(listOf(item(loud), item(quiet)))
        // -6 from the server is held to -5 dB: never more than a few dB down.
        near(0.5f * 0.5623f, player.volume)
        // The native player moves on by itself (auto-advance, the car's Next).
        player.seekTo(1, 0)
        near(0.5f * 1.4125f, player.volume)
        // The person's level is still what they set.
        near(0.5f, level.volume)
    }

    @Test fun `the slider moves the level without wiping the song's gain`() {
        server[loud] = -4.0
        player.setMediaItems(listOf(item(loud)))
        level.volume = 0.8f
        near(0.8f * 0.6310f, player.volume)
        level.volume = 0.2f
        near(0.2f * 0.6310f, player.volume)
    }

    @Test fun `off, or a song with no measurement, plays at the person's level`() {
        server[loud] = -4.0
        level.volume = 0.7f
        player.setMediaItems(listOf(item(upload), item(loud)))
        near(0.7f, player.volume)
        assertEquals(listOf(loud), asked) // an upload is never asked about; the next song is
        player.seekTo(1, 0)
        near(0.7f * 0.6310f, player.volume)
        normalizer.setEnabled(false)
        near(0.7f, player.volume)
        normalizer.setEnabled(true)
        near(0.7f * 0.6310f, player.volume)
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
        server[loud] = -4.0
        level.volume = 1f
        player.setMediaItems(listOf(item(loud)))
        val duck = OverlayDuck(0.3)
        player.volume = duck.start(player.volume)
        near(0.6310f * 0.3f, player.volume)
        player.volume = duck.base
        near(0.6310f, player.volume)
    }

    @Test fun `old -14 LUFS gains kept by earlier versions are dropped and asked again`() {
        prefs.edit().putString("gains", JSONObject().put(loud, -8.0).toString()).commit()
        val fresh = GainStore(prefs)
        assertNull(fresh.get(loud))
        assertEquals(false, prefs.contains("gains"))
        fresh.put(loud, -1.0)
        assertEquals(-1.0, GainStore(prefs).get(loud)!!, 1e-9)
    }

    // ── Boost past full volume, and fades ──────────────────────────────

    private class FakeBooster : Booster {
        val sets = ArrayList<Float>()
        override fun setBoost(linear: Float) { sets.add(linear) }
        override fun release() {}
    }

    /** A clock and a delay queue the test runs by hand, like the service's
     *  Handler; and an io queue, so a gain can arrive after the song started. */
    private inner class Rig(val booster: Booster? = null) {
        var clock = 0L
        val timers = ArrayList<Pair<Long, Runnable>>()
        val ioQueue = ArrayList<Runnable>()
        val exo = ExoPlayer.Builder(app).build().also { players.add(it) }
        /** An unprepared player never plays: say it does, so a change is heard. */
        var playing = true
        val player: Player = object : ForwardingPlayer(exo) {
            override fun isPlaying() = playing
        }
        val store = GainStore(null)
        val normalizer = Normalizer(
            player, store, { server[it] }, { ioQueue.add(it) }, direct,
            booster = booster,
            delay = { ms, r -> timers.add(clock + ms to r) },
            now = { clock },
        )
        val level = LevelPlayer(player, normalizer)
        fun answer() { val q = ArrayList(ioQueue); ioQueue.clear(); q.forEach { it.run() } }
        fun advance(ms: Long) {
            val end = clock + ms
            while (true) {
                val next = timers.minByOrNull { it.first }?.takeIf { it.first <= end } ?: break
                timers.remove(next)
                clock = next.first
                next.second.run()
            }
            clock = end
        }
    }
    private val players = ArrayList<ExoPlayer>()
    @After fun releaseRigs() = players.forEach { it.release() }

    @Test fun `a quiet song comes up past full volume through the booster`() {
        val booster = FakeBooster()
        val rig = Rig(booster)
        rig.store.put(quiet, 3.0)
        rig.store.put(loud, -4.0)
        rig.level.volume = 0.85f
        rig.player.setMediaItems(listOf(item(quiet), item(loud)))
        near(1f, rig.player.volume)
        near(0.85f * 1.4125f, booster.sets.last())
        // The next song needs no boost: the booster goes off at the change.
        rig.player.seekTo(1, 0)
        near(0.85f * 0.6310f, rig.player.volume)
        near(1f, booster.sets.last())
        // The person's level is still theirs.
        near(0.85f, rig.level.volume)
    }

    @Test fun `the real booster never throws, with or without an enhancer on this device`() {
        val p = ExoPlayer.Builder(app).build().also { players.add(it) }
        val b = LoudnessBooster(p)
        b.setBoost(1.5f)
        b.setBoost(1.5f)
        b.setBoost(1f)
        b.setBoost(2f)
        b.release()
    }

    @Test fun `a gain that arrives after the song started fades in, never jumps`() {
        val rig = Rig()
        server[loud] = -4.0
        rig.level.volume = 0.8f
        rig.player.setMediaItems(listOf(item(loud)))
        near(0.8f, rig.player.volume) // not known yet: unchanged
        rig.answer()
        near(0.8f, rig.player.volume) // arrived: nothing jumped
        rig.advance(200)
        val mid = rig.player.volume
        assert(mid < 0.8f * 0.98f && mid > 0.8f * 0.6310f * 1.02f) { "mid-fade $mid" }
        // The slider mid-fade moves at once, and the fade carries on.
        rig.level.volume = 0.4f
        assert(rig.player.volume < 0.4f && rig.player.volume > 0.4f * 0.6310f)
        rig.advance(300)
        near(0.4f * 0.6310f, rig.player.volume)
        assertEquals(true, rig.timers.isEmpty())
    }

    @Test fun `a song change mid-fade lands at once and ends the fade`() {
        val rig = Rig()
        server[loud] = -4.0
        rig.store.put(quiet, 2.0)
        rig.level.volume = 0.5f
        rig.player.setMediaItems(listOf(item(loud), item(quiet)))
        rig.answer()
        rig.advance(100)
        rig.player.seekTo(1, 0)
        near(0.5f * 1.2589f, rig.player.volume)
        rig.advance(1000)
        near(0.5f * 1.2589f, rig.player.volume)
    }

    @Test fun `not playing, nothing is heard, so a late gain lands at once`() {
        val rig = Rig()
        rig.playing = false
        server[loud] = -4.0
        rig.level.volume = 0.8f
        rig.player.setMediaItems(listOf(item(loud)))
        rig.answer()
        near(0.8f * 0.6310f, rig.player.volume)
        assertEquals(true, rig.timers.isEmpty())
    }

    @Test fun `switching it off or on fades`() {
        val rig = Rig()
        rig.store.put(loud, -4.0)
        rig.level.volume = 1f
        rig.player.setMediaItems(listOf(item(loud)))
        near(0.6310f, rig.player.volume)
        rig.normalizer.setEnabled(false)
        near(0.6310f, rig.player.volume)
        rig.advance(200)
        assert(rig.player.volume > 0.64f && rig.player.volume < 0.99f)
        rig.advance(300)
        near(1f, rig.player.volume)
    }

    @Test fun `ServerApi reads the loudness route`() {
        val web = MockWebServer()
        try {
            web.enqueue(MockResponse().setBody("""{"gainDb":-4.5}"""))
            web.enqueue(MockResponse().setBody("""{"gainDb":null}"""))
            val api = ServerApi(web.url("/").toString().trimEnd('/')) { null }
            assertEquals(-4.5, api.trackGain(loud)!!, 1e-9)
            assertNull(api.trackGain(quiet))
            assertEquals("/api/tracks/youtube%3Aloudloudlou/loudness?v=2", web.takeRequest().path)
        } finally {
            web.shutdown()
        }
    }
}
