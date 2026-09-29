package app.ember.music

import androidx.media3.common.MediaItem
import androidx.media3.session.MediaConstants
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/** The car's browse tree (BrowseTree): tabs, Home, long lists in pages,
 *  covers the car can load, and what it shows offline. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrowseTreeCarTest {
    private val server = MockWebServer().apply { start() }
    private val base = server.url("/").toString().trimEnd('/')
    private val api = ServerApi(base) { "pb_auth=x" }
    private val auth = "app.ember.music.artwork"

    @After fun tearDown() { runCatching { server.shutdown() } }

    private fun t(id: String, extra: String = "") =
        """{"id":"$id","title":"T $id","artist":"A","durationSec":61,"streamUrl":"/api/youtube/stream/$id"$extra}"""
    private fun tracks(vararg ids: String) = """{"tracks":[${ids.joinToString(",") { t(it) }}]}"""
    private fun json(body: String) = server.enqueue(MockResponse().setBody(body))

    @Test fun `a car that shows fewer tabs gets the first ones`() {
        assertEquals(listOf(BrowseTree.HOME, BrowseTree.LIKED), BrowseTree.tabsFor(2))
        assertEquals(4, BrowseTree.tabsFor(0).size)
        assertEquals(4, BrowseTree.tabsFor(9).size)
        val tree = BrowseTree(api)
        assertEquals(listOf(BrowseTree.HOME, BrowseTree.LIKED, BrowseTree.PLAYLISTS), tree.children(BrowseTree.ROOT, rootLimit = 3).map { it.mediaId })
    }

    @Test fun `playlists ask for a grid, the root for lists and search`() {
        val tabs = BrowseTree(api).children(BrowseTree.ROOT)
        val playlists = tabs.first { it.mediaId == BrowseTree.PLAYLISTS }
        assertEquals(MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM, playlists.mediaMetadata.extras!!.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE))
        val root = BrowseTree.rootExtras()
        assertEquals(MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM, root.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE))
        assertTrue(root.getBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED"))
    }

    @Test fun `home has recently played, each song once, then playlists, under headings`() {
        json(tracks("a", "b", "a", "c"))
        json("""{"playlists":[{"id":"p1","name":"Road","artwork_url":"/pb/api/files/playlists/p1/cover.jpg"}]}""")
        val home = BrowseTree(api, auth).children(BrowseTree.HOME)
        assertEquals(listOf("home-recent|a", "home-recent|b", "home-recent|c", "playlist:p1"), home.map { it.mediaId })
        val group = MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE
        assertEquals("Recently played", home[0].mediaMetadata.extras!!.getString(group))
        assertEquals("Your playlists", home[3].mediaMetadata.extras!!.getString(group))
        // The playlist's picture on the Ember server goes out as a content URI.
        assertEquals("content://$auth/playlist/p1/cover.jpg", home[3].mediaMetadata.artworkUri.toString())
    }

    @Test fun `home with one section down still shows the other, both down is a failure`() {
        json(tracks("a"))
        server.enqueue(MockResponse().setResponseCode(500))
        assertEquals(listOf("home-recent|a"), BrowseTree(api).children(BrowseTree.HOME).map { it.mediaId })
        server.enqueue(MockResponse().setResponseCode(500))
        server.enqueue(MockResponse().setResponseCode(500))
        val failed = runCatching { BrowseTree(api).children(BrowseTree.HOME) }.exceptionOrNull()
        assertTrue(failed is IOException)
    }

    @Test fun `a long list comes in pages, and a tap plays on through the whole list`() {
        val ids = (1..250).map { "s$it" }
        json(tracks(*ids.toTypedArray()))
        val tree = BrowseTree(api)
        val pages = tree.children(BrowseTree.LIKED)
        assertEquals(listOf("liked~0", "liked~1", "liked~2"), pages.map { it.mediaId })
        assertEquals(listOf("Songs 1–100", "Songs 101–200", "Songs 201–250"), pages.map { it.mediaMetadata.title.toString() })
        assertTrue(pages.all { it.mediaMetadata.isBrowsable == true })
        val second = tree.children("liked~1")
        assertEquals(100, second.size)
        assertEquals("liked|s101", second[0].mediaId)
        assertEquals(50, tree.children("liked~2").size)
        assertEquals(emptyList<MediaItem>(), tree.children("liked~3"))
        // Tapped on page two: the rest of Liked songs, not just that page.
        assertEquals(150, tree.queueFor(second[0].mediaId).size)
        assertEquals(1, server.requestCount)
    }

    @Test fun `a page asked for first (the car reopening) fetches its list`() {
        json(tracks(*(1..150).map { "s$it" }.toTypedArray()))
        val page = BrowseTree(api).children("recent~1")
        assertEquals(50, page.size)
        assertEquals("recent|s101", page[0].mediaId)
    }

    @Test fun `Media3 paging slices a list`() {
        val items = (0 until 5).map { MediaItem.Builder().setMediaId("m$it").build() }
        assertEquals(listOf("m2", "m3"), BrowseTree.page(items, 1, 2).map { it.mediaId })
        assertEquals(listOf("m4"), BrowseTree.page(items, 2, 2).map { it.mediaId })
        assertEquals(emptyList<MediaItem>(), BrowseTree.page(items, 3, 2))
        assertEquals(5, BrowseTree.page(items, 0, Int.MAX_VALUE).size)
        assertEquals("no overflow past the end", emptyList<MediaItem>(), BrowseTree.page(items, Int.MAX_VALUE, Int.MAX_VALUE))
    }

    @Test fun `songs in lists carry title, artist, length and cover, but not the whole track`() {
        server.enqueue(MockResponse().setBody("""{"tracks":[${t("upload:1", ""","artworkUrl":"/api/uploads/rec1/art"""")},${t("youtube:y", ""","artworkUrl":"https://i.ytimg.com/vi/y/hq.jpg"""")}]}"""))
        val list = BrowseTree(api, auth).children(BrowseTree.UPLOADS)
        val upload = list[0].mediaMetadata
        assertEquals("T upload:1", upload.title.toString())
        assertEquals("A", upload.artist.toString())
        assertEquals(61_000L, upload.durationMs)
        // Uploads' covers need the cookie: the car loads them from Ember.
        assertEquals("content://$auth/upload/rec1", upload.artworkUri.toString())
        // Google's covers the car loads itself.
        assertEquals("https://i.ytimg.com/vi/y/hq.jpg", list[1].mediaMetadata.artworkUri.toString())
        assertNull("the JSON stays in the tree", TrackItems.trackOf(list[0]))
        assertNull(list[0].localConfiguration)
    }

    @Test fun `the Liked tab tells the heart button which songs are liked`() {
        json(tracks("a", "b"))
        var got: List<String>? = null
        BrowseTree(api, onLiked = { got = it }).children(BrowseTree.LIKED)
        assertEquals(listOf("a", "b"), got)
    }

    @Test fun `library holds recently played, uploads and the songs on the phone`() {
        val lib = BrowseTree(api).children(BrowseTree.LIBRARY)
        assertEquals(listOf(BrowseTree.RECENT, BrowseTree.UPLOADS, BrowseTree.DOWNLOADS), lib.map { it.mediaId })
    }

    @Test fun `downloads play from the phone with their own covers`() {
        val song = JSONObject(t("youtube:d"))
        val tree = BrowseTree(api, auth, downloads = { listOf(song) }, downloadedArt = { it == "youtube:d" })
        val list = tree.children(BrowseTree.DOWNLOADS)
        assertEquals("downloads|youtube:d", list[0].mediaId)
        assertEquals("content://$auth/track/youtube%3Ad", list[0].mediaMetadata.artworkUri.toString())
        assertEquals(MediaConstants.EXTRAS_VALUE_STATUS_DOWNLOADED, list[0].mediaMetadata.extras!!.getLong(MediaConstants.EXTRAS_KEY_DOWNLOAD_STATUS))
        assertEquals(listOf("youtube:d"), tree.queueFor(list[0].mediaId).map { it.getString("id") })
        assertEquals("No songs downloaded to this phone", BrowseTree(api).children(BrowseTree.DOWNLOADS)[0].mediaMetadata.title.toString())
    }

    @Test fun `offline, the server's lists become the downloads, and search looks through them`() {
        val songs = listOf(JSONObject(t("youtube:d1")).put("title", "Night Drive"), JSONObject(t("youtube:d2")).put("title", "Morning"))
        val tree = BrowseTree(api, auth, downloads = { songs }, online = { false })
        for (tab in listOf(BrowseTree.HOME, BrowseTree.LIKED, BrowseTree.PLAYLISTS, BrowseTree.RECENT, "playlist:p1")) {
            val list = tree.children(tab)
            assertEquals("You're offline. Songs on this phone:", list[0].mediaMetadata.title.toString())
            assertFalse(list[0].mediaMetadata.isPlayable == true)
            assertEquals(listOf("downloads|youtube:d1", "downloads|youtube:d2"), list.drop(1).map { it.mediaId })
        }
        assertEquals(0, server.requestCount)
        assertEquals(listOf("search:night|youtube:d1"), tree.search("night").map { it.mediaId })
        assertEquals("You're offline. Nothing on this phone matches", tree.search("zzz")[0].mediaMetadata.title.toString())
        assertEquals("You're offline", BrowseTree(api, online = { false }).children(BrowseTree.LIKED).single().mediaMetadata.title.toString())
    }

    @Test fun `a refused session asks to sign in, anything else says try again`() {
        assertEquals("Sign in to Ember on your phone", BrowseTree.failureText(IOException("GET /api/likes -> 401")))
        assertEquals("Can't reach Ember. Try again in a moment", BrowseTree.failureText(IOException("timeout")))
    }
}
