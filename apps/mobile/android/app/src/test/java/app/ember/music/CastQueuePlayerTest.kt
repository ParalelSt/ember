package app.ember.music

import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The queue while casting: every song reaches the TV on a signed link, in
 *  the order the changes came in, even though signing is a network call.
 *  A real (unprepared) ExoPlayer stands in for the CastPlayer. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CastQueuePlayerTest {
    private val base = "https://ember.example"
    private val tv = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
    private val ioTasks = ArrayList<Runnable>()
    private val asked = ArrayList<List<String>>()
    private var serverUp = true
    private val signer = CastSigner({ ids ->
        asked.add(ids)
        if (!serverUp) throw java.io.IOException("offline")
        ids.associateWith { CastLink("$base/signed/$it", null, "audio/mp4", System.currentTimeMillis() / 1000 + 6 * 3600) }
    })
    private val queue = CastQueuePlayer(tv, signer, base, { ioTasks.add(it) }, { it.run() })

    @After fun release() = tv.release()

    private fun runIo() {
        while (ioTasks.isNotEmpty()) ioTasks.removeAt(0).run()
    }

    private fun item(id: String) = TrackItems.toMediaItem(
        JSONObject().put("id", id).put("title", id).put("artist", "A").put("streamUrl", "/api/youtube/stream/${id.substringAfter(':')}"),
        base,
    )
    private fun yt(n: Int) = item("youtube:song${n.toString().padStart(7, '0')}")
    private fun ids() = (0 until tv.mediaItemCount).map { tv.getMediaItemAt(it).mediaId }
    private fun uris() = (0 until tv.mediaItemCount).map { tv.getMediaItemAt(it).localConfiguration!!.uri.toString() }

    @Test fun `a new queue waits for its links, then goes over signed, where it was asked to start`() {
        val songs = listOf(yt(1), yt(2), yt(3))
        queue.setMediaItems(songs, 1, 42_000)
        assertEquals(0, tv.mediaItemCount)
        assertTrue(queue.pending)
        runIo()
        assertEquals(songs.map { it.mediaId }, ids())
        assertEquals(songs.map { "$base/signed/${it.mediaId}" }, uris())
        assertEquals("audio/mp4", tv.getMediaItemAt(0).localConfiguration!!.mimeType)
        assertEquals(1, tv.currentMediaItemIndex)
        assertEquals(42_000L, tv.currentPosition)
        assertFalse(queue.pending)
    }

    @Test fun `changes apply in the order they came in, even when a later one needs no signing`() {
        queue.setMediaItems(listOf(yt(1), yt(2)), 0, 0)
        runIo()
        queue.setMediaItems(listOf(yt(3), yt(4)), 0, 0) // needs links
        queue.addMediaItems(listOf(yt(1))) // has one already
        assertEquals(listOf(yt(1), yt(2)).map { it.mediaId }, ids())
        runIo()
        assertEquals(listOf(yt(3), yt(4), yt(1)).map { it.mediaId }, ids())
    }

    @Test fun `songs with fresh links go over at once, with no call to the server`() {
        queue.setMediaItems(listOf(yt(1), yt(2)), 0, 0)
        runIo()
        val calls = asked.size
        queue.replaceMediaItems(1, 2, listOf(yt(1)))
        assertEquals(listOf(yt(1), yt(1)).map { it.mediaId }, ids())
        assertEquals(calls, asked.size)
    }

    @Test fun `radio appended while casting is signed too`() {
        queue.setMediaItems(listOf(yt(1)), 0, 0)
        runIo()
        queue.addMediaItems(listOf(yt(5), yt(6)))
        runIo()
        assertEquals("$base/signed/${yt(6).mediaId}", uris().last())
        assertEquals(listOf(listOf(yt(1).mediaId), listOf(yt(5).mediaId, yt(6).mediaId)), asked)
    }

    @Test fun `a server that cannot be reached is asked once, and the songs go over as they are`() {
        serverUp = false
        queue.setMediaItems(listOf(yt(1)), 0, 0)
        runIo()
        assertEquals(listOf(yt(1).mediaId), ids())
        assertEquals("$base/api/youtube/stream/${yt(1).mediaId.substringAfter(':')}", uris().single())
        assertEquals(1, asked.size)
        assertFalse(queue.pending)
    }

    @Test fun `a song that cannot be signed never waits for the server`() {
        queue.setMediaItems(listOf(item("jamendo:42")), 0, 0)
        assertEquals(listOf("jamendo:42"), ids())
        assertTrue(asked.isEmpty())
    }

    @Test fun `a queue paused while its links were fetched lands paused`() {
        queue.setMediaItems(listOf(yt(1)), 0, 0)
        queue.pause()
        runIo()
        assertFalse(tv.playWhenReady)
        queue.setMediaItems(listOf(yt(2)), 0, 0)
        queue.play()
        runIo()
        assertTrue(tv.playWhenReady)
    }

    @Test fun `a very long queue goes over as the songs from the playing one on`() {
        val songs = (0 until 400).map { MediaItem.Builder().setMediaId("s$it").build() }
        val (part, at) = CastQueuePlayer.window(songs, 250)
        assertEquals(300 - 150, part.size)
        assertEquals("s250", part.first().mediaId)
        assertEquals(0, at)
        val (all, same) = CastQueuePlayer.window(songs.take(300), 250)
        assertEquals(300, all.size)
        assertEquals(250, same)
        val (fromStart, _) = CastQueuePlayer.window(songs, 10)
        assertEquals(300, fromStart.size)
    }

    @Test fun `a jump or a removal sent while the new queue is signed lands on the new queue`() {
        queue.setMediaItems(listOf(yt(1), yt(2)), 0, 0)
        runIo()
        // A new list, then (before its links are back) a jump to its third
        // song and the first one removed: both mean places in the NEW list.
        queue.setMediaItems(listOf(yt(3), yt(4), yt(5)), 0, 0)
        queue.seekTo(2, 7_000)
        queue.removeMediaItem(0)
        queue.seekToPreviousMediaItem()
        assertEquals(listOf(yt(1), yt(2)).map { it.mediaId }, ids())
        assertEquals(0, tv.currentMediaItemIndex)
        runIo()
        assertEquals(listOf(yt(4), yt(5)).map { it.mediaId }, ids())
        assertEquals(yt(4).mediaId, tv.currentMediaItem!!.mediaId)
        assertFalse(queue.pending)
        // With nothing waiting, a jump is immediate.
        queue.seekTo(1, 0)
        assertEquals(1, tv.currentMediaItemIndex)
    }

    @Test fun `everything else reaches the TV untouched`() {
        queue.setMediaItems(listOf(yt(1), yt(2)), 0, 0)
        runIo()
        queue.seekTo(1, 5_000)
        assertEquals(1, tv.currentMediaItemIndex)
        queue.repeatMode = Player.REPEAT_MODE_ALL
        assertEquals(Player.REPEAT_MODE_ALL, tv.repeatMode)
    }
}
