package app.ember.music

import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** A Cast session starting and ending: the queue, the song, where it is and
 *  whether it plays move to the TV and back. Two real (unprepared)
 *  ExoPlayers stand in for the phone's player and the CastPlayer. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CastSwitchTest {
    private val base = "https://ember.example"
    private val app = RuntimeEnvironment.getApplication()
    private val phone = ExoPlayer.Builder(app).build()
    private val tv = ExoPlayer.Builder(app).build()
    private val active = ArrayList<Player>()
    private val switch = CastSwitch(phone, tv, base) { active.add(it) }

    @After fun release() {
        phone.release()
        tv.release()
    }

    private fun song(id: String) = TrackItems.toMediaItem(
        JSONObject().put("id", "youtube:$id").put("title", id).put("artist", "A").put("streamUrl", "/api/youtube/stream/$id"),
        base,
    )
    private fun ids(p: Player) = (0 until p.mediaItemCount).map { p.getMediaItemAt(it).mediaId }

    @Test fun `starting a session moves the queue to the TV from where the song was`() {
        phone.setMediaItems(listOf(song("aaaaaaaaaaa"), song("bbbbbbbbbbb"), song("ccccccccccc")), 1, 61_000)
        phone.repeatMode = Player.REPEAT_MODE_ALL
        phone.playWhenReady = true
        switch.toRemote()
        assertTrue(switch.casting)
        assertSame(tv, switch.active)
        assertEquals(listOf<Player>(tv), active)
        assertEquals(ids(phone), ids(tv))
        assertEquals(1, tv.currentMediaItemIndex)
        assertEquals(61_000L, tv.currentPosition)
        assertEquals(Player.REPEAT_MODE_ALL, tv.repeatMode)
        assertTrue(tv.playWhenReady)
        // The phone stops, but keeps its queue.
        assertEquals(Player.STATE_IDLE, phone.playbackState)
        assertEquals(3, phone.mediaItemCount)
    }

    @Test fun `a paused song goes over paused`() {
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 5_000)
        switch.toRemote()
        assertFalse(tv.playWhenReady)
    }

    @Test fun `ending it brings back what the TV had, paused where the TV was, streaming with the cookie`() {
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        phone.playWhenReady = true
        switch.toRemote()
        // Radio added a song on the TV, which moved on and played for a while.
        val signed = CastItems.forCast(song("ddddddddddd"), CastLink("$base/signed?st=x", null, "audio/mp4", Long.MAX_VALUE), base)
        tv.addMediaItem(signed)
        tv.seekTo(1, 95_000)
        switch.toLocal()
        assertFalse(switch.casting)
        assertSame(phone, active.last())
        assertEquals(listOf("youtube:aaaaaaaaaaa", "youtube:ddddddddddd"), ids(phone))
        assertEquals(1, phone.currentMediaItemIndex)
        assertEquals(95_000L, phone.currentPosition)
        assertFalse(phone.playWhenReady)
        assertEquals("$base/api/youtube/stream/ddddddddddd", phone.getMediaItemAt(1).localConfiguration!!.uri.toString())
    }

    @Test fun `each direction only happens once`() {
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        switch.toLocal()
        assertTrue(active.isEmpty())
        switch.toRemote()
        switch.toRemote()
        assertEquals(1, active.size)
    }

    @Test fun `an empty phone hands over nothing`() {
        switch.toRemote()
        assertEquals(0, tv.mediaItemCount)
        assertTrue(switch.casting)
    }

    @Test fun `the session moves to the TV only once the TV has the queue`() {
        val io = ArrayList<Runnable>()
        val signer = CastSigner({ ids -> ids.associateWith { CastLink("$base/signed/$it", null, "audio/mp4", System.currentTimeMillis() / 1000 + 6 * 3600) } })
        val queue = CastQueuePlayer(tv, signer, base, { io.add(it) }, { it.run() })
        val timeouts = ArrayList<() -> Unit>()
        val moves = ArrayList<Pair<Player, List<String>>>()
        val sw = CastSwitch(phone, queue, base, queue::afterPending, { _, fn -> timeouts.add(fn) }) { p -> moves.add(p to ids(p)) }
        phone.setMediaItems(listOf(song("aaaaaaaaaaa"), song("bbbbbbbbbbb")), 1, 10_000)
        sw.toRemote()
        // Still signing: the session (and so the app) stays on the phone,
        // which still shows the queue. It never sees an empty one.
        assertTrue(moves.isEmpty())
        assertTrue(sw.casting)
        while (io.isNotEmpty()) io.removeAt(0).run()
        assertEquals(1, moves.size)
        assertSame(queue, moves[0].first)
        assertEquals(listOf("youtube:aaaaaaaaaaa", "youtube:bbbbbbbbbbb"), moves[0].second)
        // The give-up timer finds it done already.
        timeouts.forEach { it() }
        assertEquals(1, moves.size)
    }

    @Test fun `a TV that never reports the queue still gets the session after the timeout`() {
        val io = ArrayList<Runnable>()
        val queue = CastQueuePlayer(tv, CastSigner({ emptyMap() }), base, { io.add(it) }, { it.run() })
        val timeouts = ArrayList<() -> Unit>()
        val moves = ArrayList<Player>()
        val sw = CastSwitch(phone, queue, base, queue::afterPending, { _, fn -> timeouts.add(fn) }) { moves.add(it) }
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        sw.toRemote()
        assertTrue(moves.isEmpty())
        timeouts.forEach { it() }
        assertEquals(listOf<Player>(queue), moves)
    }

    @Test fun `on the way back the phone has the TV's queue before the session returns`() {
        val seen = ArrayList<List<String>>()
        val sw = CastSwitch(phone, tv, base) { p -> if (p === phone) seen.add(ids(phone)) }
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        sw.toRemote()
        tv.addMediaItem(song("ddddddddddd"))
        sw.toLocal()
        assertEquals(listOf(listOf("youtube:aaaaaaaaaaa", "youtube:ddddddddddd")), seen)
    }

    @Test fun `a TV that emptied its queue before the session ended still gives the queue back`() {
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        switch.toRemote()
        tv.addMediaItem(song("ddddddddddd"))
        tv.seekTo(1, 40_000)
        switch.remember()
        // Stopped from the TV: it reports nothing, then the session ends.
        tv.clearMediaItems()
        switch.toLocal()
        assertEquals(listOf("youtube:aaaaaaaaaaa", "youtube:ddddddddddd"), ids(phone))
        assertEquals(1, phone.currentMediaItemIndex)
        assertEquals(40_000L, phone.currentPosition)
    }

    @Test fun `a session already running is followed, not overwritten`() {
        tv.setMediaItems(listOf(song("zzzzzzzzzzz")), 0, 30_000)
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        switch.adoptRemote()
        assertEquals(listOf("youtube:zzzzzzzzzzz"), ids(tv))
        assertEquals(30_000L, tv.currentPosition)
        assertSame(tv, switch.active)
    }

    @Test fun `the phone's audio effects let go while casting and come back after`() {
        val casting = ArrayList<Boolean>()
        val sw = CastSwitch(phone, tv, base, onCasting = { casting.add(it) }) { }
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 5_000)
        sw.toRemote()
        assertEquals(listOf(true), casting)
        sw.toRemote()
        assertEquals(listOf(true), casting)
        sw.toLocal()
        assertEquals(listOf(true, false), casting)
        // The queue is already back on the phone when it hears so.
        assertEquals(1, phone.mediaItemCount)
        sw.toLocal()
        assertEquals(listOf(true, false), casting)
    }

    @Test fun `a session already running when the service starts counts as casting`() {
        val casting = ArrayList<Boolean>()
        val sw = CastSwitch(phone, tv, base, onCasting = { casting.add(it) }) { }
        sw.adoptRemote()
        assertEquals(listOf(true), casting)
    }

    @Test fun `the loudness booster is off while casting, with the real switch`() {
        val made = ArrayList<Boolean>()
        var fx: LoudnessBooster.Effect? = null
        val booster = LoudnessBooster(phone, { 5 }) {
            object : LoudnessBooster.Effect {
                override fun setTargetGain(mb: Int) {}
                override fun setEnabled(on: Boolean) { made.add(on) }
                override fun release() {}
            }.also { fx = it }
        }
        val sw = CastSwitch(phone, tv, base, onCasting = booster::setSuspended) { }
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        booster.setBoost(1.4f)
        assertTrue(booster.attached)
        sw.toRemote()
        assertFalse(booster.attached)
        assertEquals(false, made.last())
        sw.toLocal()
        assertTrue(booster.attached)
        assertEquals(true, made.last())
        assertTrue(fx != null)
        booster.release()
    }
}
