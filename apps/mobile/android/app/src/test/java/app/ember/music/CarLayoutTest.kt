package app.ember.music

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.os.Bundle
import android.os.Looper
import android.os.Process
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The owner's Android Auto picks (carlayout2): tabs Library, Radio and
 * Recent; covers (a grid) for playlists and radio, rows for songs; Like and
 * Shuffle beside the player's controls.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarLayoutTest {
    private val server = MockWebServer()
    private val asked = CopyOnWriteArrayList<String>()
    @Volatile private var likeStatus = 200

    private val app = RuntimeEnvironment.getApplication()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService

    private val grid = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM
    private val list = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM
    private val browsable = MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE
    private val playable = MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE

    @After fun tearDown() {
        if (::controller.isInitialized) runCatching { controller.destroy() }
        MediaCache.releaseShared()
        runCatching { server.shutdown() }
    }

    private fun t(id: String) = """{"id":"$id","title":"T $id","artist":"A","durationSec":120,"streamUrl":"/api/youtube/stream/$id"}"""

    private fun serve() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                asked.add("${request.method} $path")
                return when {
                    path == "/api/playlists" -> MockResponse().setBody("""{"playlists":[{"id":"p1","name":"Road trip","artwork_url":null},{"id":"p2","name":"Night drive","artwork_url":null}]}""")
                    path == "/api/history" -> MockResponse().setBody("""{"tracks":[${t("a")},${t("b")},${t("a")}]}""")
                    path.startsWith("/api/likes") && request.method != "GET" -> MockResponse().setResponseCode(likeStatus).setBody("{}")
                    path == "/api/likes" -> MockResponse().setBody("""{"tracks":[${t("a")}]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
    }

    private fun tree() = BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" })

    private fun style(item: androidx.media3.common.MediaItem, key: String): Int? =
        item.mediaMetadata.extras?.takeIf { it.containsKey(key) }?.getInt(key)

    // ── The tree ────────────────────────────────────────────────────────

    @Test fun `the tabs are Library, Radio and Recent`() {
        serve()
        val tabs = tree().children(BrowseTree.ROOT, rootLimit = 4)
        assertEquals(listOf("Library", "Radio", "Recent"), tabs.map { it.mediaMetadata.title.toString() })
        assertTrue(tabs.all { it.mediaMetadata.isBrowsable == true && it.mediaMetadata.isPlayable == false })
        assertEquals(0, server.requestCount)
    }

    @Test fun `Library is Liked songs and the playlists, Radio its three folders, Recent the songs played lately`() {
        serve()
        val tree = tree()
        val lib = tree.children(BrowseTree.LIBRARY)
        assertEquals(listOf("Liked songs", "Road trip", "Night drive", "Uploads", "On this phone"), lib.map { it.mediaMetadata.title.toString() })
        assertEquals(listOf("Nearby", "Favourites", "Croatia"), tree.children(BrowseTree.RADIO).map { it.mediaMetadata.title.toString() })
        val recent = tree.children(BrowseTree.RECENT)
        assertEquals(listOf("recent|a", "recent|b"), recent.map { it.mediaId })
        assertTrue(recent.all { it.mediaMetadata.isPlayable == true })
    }

    @Test fun `playlists and radio show as covers, songs as rows`() {
        serve()
        val tree = tree()
        val tabs = tree.children(BrowseTree.ROOT).associateBy { it.mediaId }
        // Library: its folders (Liked songs, playlists) as a grid.
        assertEquals(grid, style(tabs.getValue(BrowseTree.LIBRARY), browsable))
        // Radio: its folders, and the stations in them, as a grid.
        assertEquals(grid, style(tabs.getValue(BrowseTree.RADIO), browsable))
        tree.children(BrowseTree.RADIO).forEach { assertEquals(it.mediaId, grid, style(it, playable)) }
        // Recent: songs, in rows.
        assertEquals(list, style(tabs.getValue(BrowseTree.RECENT), playable))
        // Inside Library, every folder lists its songs (and their page folders) as rows.
        tree.children(BrowseTree.LIBRARY).forEach {
            assertEquals(it.mediaId, list, style(it, playable))
            assertEquals(it.mediaId, list, style(it, browsable))
        }
        // Rows stay the default for anything else (search results).
        assertEquals(list, BrowseTree.rootExtras().getInt(playable))
    }

    // ── Like and Shuffle on the now-playing screen ──────────────────────

    private val car = MediaSession.ControllerInfo.createTestOnlyControllerInfo(
        "com.google.android.projection.gearhead", 0, 10_790, MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION, 0, false, Bundle.EMPTY)
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)

    private fun idle(ms: Long = 0) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))
    private fun until(done: () -> Boolean) {
        val end = System.currentTimeMillis() + 3_000
        while (!done() && System.currentTimeMillis() < end) { idle(10); Thread.sleep(5) }
    }
    private fun session() = service.onGetSession(own)
    private fun buttons(): List<CommandButton> = session().customLayout
    private fun names() = buttons().map { it.displayName.toString() }
    private fun command(action: String): SessionResult =
        service.Callback().onCustomCommand(session(), car, SessionCommand(action, Bundle.EMPTY), Bundle.EMPTY).get()

    /** The service with Android Auto connected, playing "a" (liked) then "b". */
    private fun startWithCar() {
        serve()
        shadowOf(app.packageManager).installPackage(PackageInfo().apply {
            packageName = car.packageName
            applicationInfo = ApplicationInfo().apply { packageName = car.packageName; uid = car.uid; flags = ApplicationInfo.FLAG_SYSTEM }
        })
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        service = controller.get()
        service.api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
        session().player.setMediaItems(listOf("a", "b").map { TrackItems.toMediaItem(JSONObject(t(it)), "http://127.0.0.1:9") }, 0, 0)
        idle()
        assertTrue(service.Callback().onConnect(session(), car).isAccepted)
        until { names().size == 2 }
    }

    @Test fun `the player shows Like and Shuffle, each with its state, and no repeat`() {
        startWithCar()
        assertEquals(listOf("Remove from Liked songs", "Shuffle off"), names())
        assertEquals(listOf(CommandButton.ICON_HEART_FILLED, CommandButton.ICON_SHUFFLE_OFF), buttons().map { it.icon })
        assertEquals(listOf(CarButtons.COMMAND_LIKE, EmberPlaybackService.COMMAND_SHUFFLE), buttons().map { it.sessionCommand!!.customAction })
        // The next song is not liked: the heart follows the song.
        session().player.seekToNextMediaItem(); idle()
        assertEquals("Add to Liked songs", names()[0])
        assertEquals(CommandButton.ICON_HEART_UNFILLED, buttons()[0].icon)
    }

    @Test fun `Like toggles the heart at once and calls the like API`() {
        startWithCar()
        assertEquals(SessionResult.RESULT_SUCCESS, command(CarButtons.COMMAND_LIKE).resultCode)
        idle()
        assertEquals("Add to Liked songs", names()[0])
        until { asked.contains("DELETE /api/likes/a") }
        assertTrue(asked.contains("DELETE /api/likes/a"))

        assertEquals(SessionResult.RESULT_SUCCESS, command(CarButtons.COMMAND_LIKE).resultCode)
        idle()
        assertEquals("Remove from Liked songs", names()[0])
        until { asked.contains("POST /api/likes") }
        assertTrue(asked.contains("POST /api/likes"))
    }

    @Test fun `a like the server refuses puts the heart back`() {
        startWithCar()
        likeStatus = 500
        command(CarButtons.COMMAND_LIKE)
        idle()
        assertEquals("Add to Liked songs", names()[0])
        until { names()[0] == "Remove from Liked songs" }
        assertEquals("Remove from Liked songs", names()[0])
    }

    @Test fun `Shuffle toggles and its button follows`() {
        startWithCar()
        command(EmberPlaybackService.COMMAND_SHUFFLE); idle()
        assertTrue(session().player.shuffleModeEnabled)
        assertEquals("Shuffle on", names()[1])
        assertEquals(CommandButton.ICON_SHUFFLE_ON, buttons()[1].icon)
        command(EmberPlaybackService.COMMAND_SHUFFLE); idle()
        assertFalse(session().player.shuffleModeEnabled)
        assertEquals("Shuffle off", names()[1])
    }
}
