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

    @Test fun `a session already running is followed, not overwritten`() {
        tv.setMediaItems(listOf(song("zzzzzzzzzzz")), 0, 30_000)
        phone.setMediaItems(listOf(song("aaaaaaaaaaa")), 0, 0)
        switch.adoptRemote()
        assertEquals(listOf("youtube:zzzzzzzzzzz"), ids(tv))
        assertEquals(30_000L, tv.currentPosition)
        assertSame(tv, switch.active)
    }
}
