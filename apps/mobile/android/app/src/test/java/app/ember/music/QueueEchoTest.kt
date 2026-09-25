package app.ember.music

import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Which native queue changes the plugin reports to the web app (the `queue`
 * event). The app's own setQueue must not come back to it; everything native
 * did by itself must, however soon after the app's last send. The old rule
 * was "nothing within 1.5 s of a send", which swallowed native radio that
 * arrived right after a tap on the last song.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QueueEchoTest {
    private fun ids(s: String) = s.map { "$it" }

    @Test fun `the app's own queue coming back is not news`() {
        val echo = QueueEcho()
        echo.sent(ids("abc"))
        assertFalse(echo.isNews(ids("abc")))
        // The service's confirmation of the same queue, later: still not news.
        assertFalse(echo.isNews(ids("abc")))
    }

    @Test fun `native radio appended right after the app's send is news`() {
        val echo = QueueEcho()
        echo.sent(ids("c"))
        // No clock involved: the change is reported because it differs.
        assertTrue(echo.isNews(ids("cxyz")))
        // And reported once.
        assertFalse(echo.isNews(ids("cxyz")))
    }

    @Test fun `the steps while QueueSync applies a send are not news`() {
        val echo = QueueEcho()
        echo.sent(ids("bcad"))
        echo.applying = true
        assertFalse(echo.isNews(ids("xyad")))
        assertFalse(echo.isNews(ids("xyadcd")))
        echo.applying = false
        assertFalse(echo.isNews(ids("bcad")))
    }

    @Test fun `the car going back to the app's last queue is still news`() {
        val echo = QueueEcho()
        echo.sent(ids("abc"))
        assertTrue(echo.isNews(ids("xyz"))) // the car's list, the app takes it
        assertTrue(echo.isNews(ids("abc"))) // the car picks the old list again
    }

    @Test fun `queueJs carries the tracks in order and the index`() {
        val items = listOf("a", "b").map {
            TrackItems.toMediaItem(JSONObject().put("id", "youtube:$it").put("title", it).put("streamUrl", "/s/$it"), "https://e")
        }
        val js = queueJs(items, 1)
        assertEquals(1, js.getInt("index"))
        val tracks = js.getJSONArray("tracks")
        assertEquals(2, tracks.length())
        assertEquals("youtube:b", tracks.getJSONObject(1).getString("id"))
        assertEquals(-1, queueJs(emptyList(), 0).getInt("index"))
    }

    /** The shape the plugin reads from the controller, on a real player:
     *  a native append lands as a different id list. */
    @Test fun `an append on a real player reads as news`() {
        val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
        try {
            val item = { id: String -> TrackItems.toMediaItem(JSONObject().put("id", id).put("streamUrl", "/s/$id"), "https://e") }
            val echo = QueueEcho()
            player.setMediaItems(listOf(item("c")))
            echo.sent(listOf("c"))
            player.addMediaItems(listOf(item("x"), item("y")))
            val now = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
            assertTrue(echo.isNews(now))
        } finally {
            player.release()
        }
    }
}
