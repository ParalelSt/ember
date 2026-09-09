package app.ember.music

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrowseTreeTest {
    @Test fun rootHasTheFourTabsAndAPlaylistExpandsToTracks() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"playlists":[{"id":"p1","name":"Road","artwork_url":null}]}"""))
        server.enqueue(MockResponse().setBody("""{"playlist":{"id":"p1","name":"Road"},"tracks":[{"id":"youtube:a","title":"A","artist":"X","streamUrl":"/api/youtube/stream/a"}]}"""))
        server.start()
        val tree = BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" })
        val root = tree.children(BrowseTree.ROOT).map { it.mediaId }
        assertEquals(listOf(BrowseTree.PLAYLISTS, BrowseTree.LIKED, BrowseTree.RECENT, BrowseTree.UPLOADS), root)
        val playlists = tree.children(BrowseTree.PLAYLISTS)
        assertEquals("playlist:p1", playlists[0].mediaId)
        assertTrue(playlists[0].mediaMetadata.isBrowsable == true)
        val tracks = tree.children("playlist:p1")
        assertEquals("youtube:a", tracks[0].mediaId)
        assertTrue(tracks[0].mediaMetadata.isPlayable == true)
        server.shutdown()
    }

    /** A legacy browser (Android Auto, the car) taps with only an id. */
    @Test fun aTappedIdResolvesToTheRestOfTheListItWasShownIn() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"tracks":[{"id":"upload:1","title":"One","artist":"X","streamUrl":"/api/uploads/1/stream"},{"id":"upload:2","title":"Two","artist":"X","streamUrl":"/api/uploads/2/stream"},{"id":"upload:3","title":"Three","artist":"X","streamUrl":"/api/uploads/3/stream"}]}"""))
        server.start()
        val tree = BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" })
        tree.children(BrowseTree.UPLOADS)
        assertEquals("Two", tree.trackById("upload:2")!!.getString("title"))
        assertEquals(listOf("upload:2", "upload:3"), tree.queueFor("upload:2").map { it.getString("id") })
        assertEquals(emptyList<String>(), tree.queueFor("upload:nope").map { it.getString("id") })
        server.shutdown()
    }
}
