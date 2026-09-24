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
        assertEquals("playlist:p1|youtube:a", tracks[0].mediaId)
        assertTrue(tracks[0].mediaMetadata.isPlayable == true)
        server.shutdown()
    }

    @Test fun searchIsFetchedOncePerQueryAndNotForTinyQueries() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"tracks":[{"id":"youtube:s1","title":"Song","artist":"X","streamUrl":"/api/youtube/stream/s1"}]}"""))
        server.start()
        val tree = BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" })
        assertEquals(0, tree.search("ab").size)
        assertEquals(1, tree.search("abc").size)
        assertEquals(1, tree.search("abc").size)
        assertEquals(1, server.requestCount)
        server.shutdown()
    }

    /** A legacy browser (Android Auto, the car) taps with only an id. */
    @Test fun aTappedIdResolvesToTheRestOfTheListItWasShownIn() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"tracks":[{"id":"upload:1","title":"One","artist":"X","streamUrl":"/api/uploads/1/stream"},{"id":"upload:2","title":"Two","artist":"X","streamUrl":"/api/uploads/2/stream"},{"id":"upload:3","title":"Three","artist":"X","streamUrl":"/api/uploads/3/stream"}]}"""))
        server.start()
        val tree = BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" })
        val shown = tree.children(BrowseTree.UPLOADS)
        assertEquals("Two", tree.trackById("upload:2")!!.getString("title"))
        assertEquals(listOf("upload:2", "upload:3"), tree.queueFor(shown[1].mediaId).map { it.getString("id") })
        assertEquals(listOf("upload:2"), tree.queueFor("upload:2").map { it.getString("id") })
        assertEquals(emptyList<String>(), tree.queueFor("upload:nope").map { it.getString("id") })
        server.shutdown()
    }

    /** The car loads more than one list before a tap (the tab it opens, the
     *  one next to it). A tap plays the list the song was tapped in, not the
     *  one fetched last. */
    @Test fun aTapPlaysTheListItWasTappedInNotTheLastOneFetched() {
        fun t(id: String) = """{"id":"youtube:$id","title":"$id","artist":"X","streamUrl":"/api/youtube/stream/$id"}"""
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"tracks":[${t("a")},${t("b")},${t("c")}]}"""))
        server.enqueue(MockResponse().setBody("""{"tracks":[${t("b")},${t("x")},${t("y")}]}"""))
        server.start()
        val tree = BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" })
        val liked = tree.children(BrowseTree.LIKED)
        val recent = tree.children(BrowseTree.RECENT)
        val inLiked = liked.first { it.mediaMetadata.title == "b" }.mediaId
        val inRecent = recent.first { it.mediaMetadata.title == "b" }.mediaId
        assertEquals(listOf("youtube:b", "youtube:c"), tree.queueFor(inLiked).map { it.getString("id") })
        assertEquals(listOf("youtube:b", "youtube:x", "youtube:y"), tree.queueFor(inRecent).map { it.getString("id") })
        assertEquals("b", tree.trackById(inLiked)!!.getString("title"))
        server.shutdown()
    }
}
