package app.ember.music

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** setQueue's `tracks`. A malformed entry (not an object, no id) threw out of
 *  the plugin method, and Capacitor rethrows whatever a plugin method throws
 *  on its plugin thread: the app went down, music and all. The call is
 *  refused with a reason instead. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QueueItemsArgTest {
    private val base = "https://ember.example"
    private fun track(id: String) = JSONObject("""{"id":"$id","title":"T","artist":"A","streamUrl":"/api/youtube/stream/x"}""")

    @Test fun `songs become media items in queue order`() {
        val items = queueItemsArg(JSONArray().put(track("youtube:a")).put(track("youtube:b")), base, null).getOrThrow()
        assertEquals(listOf("youtube:a", "youtube:b"), items.map { it.mediaId })
    }

    @Test fun `a non-song in the list is refused, not a crash`() {
        val r = queueItemsArg(JSONArray().put(track("youtube:a")).put("not a track"), base, null)
        assertTrue(r.isFailure)
        assertEquals("tracks must be songs", r.exceptionOrNull()?.message)
    }

    @Test fun `a song without an id is refused, not a crash`() {
        val r = queueItemsArg(JSONArray().put(JSONObject().put("title", "T")), base, null)
        assertEquals("tracks must be songs", r.exceptionOrNull()?.message)
    }
}
