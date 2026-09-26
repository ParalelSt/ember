package app.ember.music

import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.util.concurrent.Executor

/**
 * "Play" from the car, a headset or the steering wheel after Android has
 * closed the app used to do nothing: the new process had an empty player
 * and no way to find the last queue. The queue is now kept on disk as it
 * changes and handed back (onPlaybackResumption) where it was.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SavedQueueTest {
    private val dir: File = Files.createTempDirectory("saved").toFile()
    private val saved = SavedQueue(File(dir, "q.json"))
    private val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
    private val direct = Executor { it.run() }

    @After fun release() = player.release()

    private fun track(id: String) = JSONObject().put("id", "youtube:$id").put("title", id).put("artist", "X").put("streamUrl", "/api/youtube/stream/$id")
    private fun item(id: String) = TrackItems.toMediaItem(track(id), "https://old.example")

    @Test fun `the queue is kept as it changes and handed back where it was`() {
        player.addListener(saved.Saver(player, direct))
        player.setMediaItems(listOf(item("a"), item("b"), item("c")), 1, 42_000)
        val back = saved.resume("https://ember.example")!!
        assertEquals(listOf("youtube:a", "youtube:b", "youtube:c"), back.mediaItems.map { it.mediaId })
        assertEquals(1, back.startIndex)
        assertEquals(42_000L, back.startPositionMs)
        // Built fresh against the server of today, stream and all.
        assertEquals("https://ember.example/api/youtube/stream/b", back.mediaItems[1].localConfiguration!!.uri.toString())

        // The next song is kept too.
        player.seekTo(2, 0)
        assertEquals(2, saved.resume("https://ember.example")!!.startIndex)
    }

    @Test fun `nothing saved, or a broken file, resumes nothing`() {
        assertNull(saved.resume("https://e"))
        File(dir, "q.json").writeText("{not json")
        assertNull(saved.resume("https://e"))
        saved.save(SavedQueue.Snapshot(emptyList(), 0, 0))
        assertNull(saved.resume("https://e"))
    }

    @Test fun `an out of range index is pulled back into the queue`() {
        saved.save(SavedQueue.Snapshot(listOf(track("a"), track("b")), 7, -5))
        val back = saved.resume("https://e")!!
        assertEquals(1, back.startIndex)
        assertEquals(0L, back.startPositionMs)
    }
}
