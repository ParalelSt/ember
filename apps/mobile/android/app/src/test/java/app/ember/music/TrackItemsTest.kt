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

    /** org.json's optString hands back the STRING "null" for a JSON null, and
     *  Media3 then tries to open a file literally called "null" for artwork. */
    @Test fun jsonNullsDoNotBecomeTheWordNull() {
        val bare = JSONObject("""{"id":"upload:x","title":"Up","artist":"Me","album":null,"artworkUrl":null,"streamUrl":"/api/uploads/x/stream"}""")
        val item = TrackItems.toMediaItem(bare, "https://ember.example")
        assertEquals(null, item.mediaMetadata.artworkUri)
        assertEquals(null, item.mediaMetadata.albumTitle)
    }

    /** Head units show the length (and a progress bar) from the metadata
     *  before the stream has said how long the song is. */
    @Test fun theCatalogLengthGoesIntoTheMetadata() {
        assertEquals(200_000L, TrackItems.toMediaItem(track, "https://ember.example").mediaMetadata.durationMs)
        val noLength = JSONObject("""{"id":"upload:x","title":"Up","artist":"Me","streamUrl":"/api/uploads/x/stream"}""")
        assertEquals(null, TrackItems.toMediaItem(noLength, "https://ember.example").mediaMetadata.durationMs)
    }

    /** An upload's cover needs the cookie: the car and the queue get it
     *  through ArtworkProvider; a YouTube cover keeps its address. */
    @Test fun anUploadCoverGoesOutAsAContentUriWhenAskedTo() {
        val up = JSONObject("""{"id":"upload:rec1","title":"Up","artist":"Me","artworkUrl":"/api/uploads/rec1/art","streamUrl":"/api/uploads/rec1/stream"}""")
        assertEquals("content://app.ember.music.artwork/upload/rec1", TrackItems.toMediaItem(up, "https://ember.example", "app.ember.music.artwork").mediaMetadata.artworkUri.toString())
        assertEquals("https://ember.example/api/uploads/rec1/art", TrackItems.toMediaItem(up, "https://ember.example").mediaMetadata.artworkUri.toString())
        assertEquals("https://i/x.jpg", TrackItems.toMediaItem(track, "https://ember.example", "app.ember.music.artwork").mediaMetadata.artworkUri.toString())
    }

    @Test fun theTrackJsonRoundTripsThroughTheItem() {
        val item = TrackItems.toMediaItem(track, "https://ember.example")
        assertEquals("Song", TrackItems.trackOf(item)!!.getString("title"))
        assertEquals(1, TrackItems.toJson(listOf(item)).length())
    }
}
