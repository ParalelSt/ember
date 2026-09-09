package app.ember.music

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TrackItemsTest {
    private val track = JSONObject("""{"id":"youtube:abc","source":"youtube","sourceId":"abc","title":"Song","artist":"Band","album":"LP","durationSec":200,"artworkUrl":"https://i/x.jpg","streamUrl":"/api/youtube/stream/abc"}""")

    @Test fun mapsIdMetadataAndAnAbsoluteStreamUrl() {
        val item = TrackItems.toMediaItem(track, "https://ember.example")
        assertEquals("youtube:abc", item.mediaId)
        assertEquals("Song", item.mediaMetadata.title.toString())
        assertEquals("Band", item.mediaMetadata.artist.toString())
        assertEquals("https://i/x.jpg", item.mediaMetadata.artworkUri.toString())
        assertEquals("https://ember.example/api/youtube/stream/abc", item.localConfiguration!!.uri.toString())
        assertTrue(item.mediaMetadata.isPlayable == true)
    }

    @Test fun theTrackJsonRoundTripsThroughTheItem() {
        val item = TrackItems.toMediaItem(track, "https://ember.example")
        assertEquals("Song", TrackItems.trackOf(item)!!.getString("title"))
        assertEquals(1, TrackItems.toJson(listOf(item)).length())
    }
}
