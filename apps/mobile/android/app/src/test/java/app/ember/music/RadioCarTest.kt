package app.ember.music

import android.Manifest
import android.content.Context
import android.location.Location
import android.location.LocationManager
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.Executor

/**
 * Live radio in the car (the web app's lib/radio): a Radio folder with
 * Nearby, favourites and Croatia; stations that stream through the host and
 * play in their list, so the car's skip moves to the next station; never a
 * play in history, a heart, or a download ahead.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RadioCarTest {
    private val server = MockWebServer()
    private val asked = ArrayList<String>()

    @After fun stop() = server.shutdown()

    private fun uuid(n: Int) = "00000000-0000-4000-8000-%012d".format(n)

    private fun stationJson(n: Int): JSONObject {
        val id = uuid(n)
        return JSONObject().put("id", id).put("name", "Station $n").put("track", JSONObject()
            .put("id", "station:$id").put("source", "station").put("sourceId", id).put("title", "Station $n")
            .put("artist", "Croatia").put("durationSec", 0).put("artworkUrl", JSONObject.NULL)
            .put("streamUrl", "/api/radio/stream/$id"))
    }

    private fun stations(vararg n: Int) = JSONObject().put("stations", JSONArray(n.map(::stationJson))).toString()

    /** Answers each radio list; records the paths asked. */
    private fun tree(location: Pair<Double, Double>? = null, favorites: String = stations()): BrowseTree {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                asked.add(path)
                return when {
                    path.startsWith("/api/radio/nearby") -> MockResponse().setBody(stations(7, 8))
                    path.startsWith("/api/radio/country") -> MockResponse().setBody(stations(1, 2, 3))
                    path.startsWith("/api/radio/favorites") -> MockResponse().setBody(favorites)
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        return BrowseTree(ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }, location = { location })
    }

    @Test fun `a car with room for five shows Radio as a tab, a four-tab car keeps its tabs and finds Radio in Library`() {
        val t = tree()
        assertEquals(listOf(BrowseTree.HOME, BrowseTree.LIKED, BrowseTree.PLAYLISTS, BrowseTree.RADIO, BrowseTree.LIBRARY), t.children(BrowseTree.ROOT).map { it.mediaId })
        assertEquals(listOf(BrowseTree.HOME, BrowseTree.LIKED, BrowseTree.PLAYLISTS, BrowseTree.LIBRARY), t.children(BrowseTree.ROOT, rootLimit = 4).map { it.mediaId })
        assertEquals(BrowseTree.RADIO, t.children(BrowseTree.LIBRARY, rootLimit = 4).first().mediaId)
        assertFalse(t.children(BrowseTree.LIBRARY).any { it.mediaId == BrowseTree.RADIO })
    }

    @Test fun `Radio holds Nearby, favourites and Croatia, without asking the server`() {
        val t = tree()
        val folders = t.children(BrowseTree.RADIO)
        assertEquals(listOf(BrowseTree.RADIO_NEARBY, BrowseTree.RADIO_FAVORITES, BrowseTree.RADIO_COUNTRY), folders.map { it.mediaId })
        assertEquals(listOf("Nearby", "Favourite stations", "Croatia"), folders.map { it.mediaMetadata.title.toString() })
        assertTrue(folders.all { it.mediaMetadata.isBrowsable == true })
        assertEquals(0, server.requestCount)
    }

    @Test fun `Nearby asks for the rounded place the phone last knew`() {
        val t = tree(location = 45.8 to 16.0)
        val items = t.children(BrowseTree.RADIO_NEARBY)
        assertEquals(listOf("Station 7", "Station 8"), items.map { it.mediaMetadata.title.toString() })
        assertTrue(asked.single().startsWith("/api/radio/nearby?lat=45.8&lng=16.0"))
    }

    @Test fun `with no known place, Nearby lists Croatia`() {
        val t = tree(location = null)
        assertEquals(3, t.children(BrowseTree.RADIO_NEARBY).size)
        assertEquals("/api/radio/country?code=HR", asked.single())
    }

    @Test fun `stations are playable live items with no length`() {
        val t = tree()
        val item = t.children(BrowseTree.RADIO_COUNTRY).first()
        assertTrue(item.mediaMetadata.isPlayable == true)
        assertEquals(MediaMetadata.MEDIA_TYPE_RADIO_STATION, item.mediaMetadata.mediaType)
        assertNull(item.mediaMetadata.durationMs)
        val playable = TrackItems.toMediaItem(t.trackById(item.mediaId)!!, "https://ember.test")
        assertEquals("https://ember.test/api/radio/stream/${uuid(1)}", playable.localConfiguration!!.uri.toString())
        assertTrue(TrackItems.isLive(playable))
    }

    @Test fun `a tapped station plays in its whole list, from the station tapped`() {
        val t = tree()
        val shown = t.children(BrowseTree.RADIO_COUNTRY)
        val (queue, at) = t.queueAt(shown[1].mediaId)
        assertEquals(listOf("station:${uuid(1)}", "station:${uuid(2)}", "station:${uuid(3)}"), queue.map { it.getString("id") })
        assertEquals(1, at)
    }

    @Test fun `no favourites yet is said in one line`() {
        val t = tree(favorites = stations())
        val items = t.children(BrowseTree.RADIO_FAVORITES)
        assertEquals(1, items.size)
        assertFalse(items[0].mediaMetadata.isPlayable == true)
    }

    @Test fun `a station is never downloaded ahead`() {
        val live = TrackItems.toMediaItem(stationJson(1).getJSONObject("track"), "https://e")
        assertNull(EmberPlaybackService.policyTrack(live).streamUrl)
        val song = TrackItems.toMediaItem(JSONObject().put("id", "youtube:a").put("streamUrl", "/s/a"), "https://e")
        assertEquals("https://e/s/a", EmberPlaybackService.policyTrack(song).streamUrl)
    }

    @Test fun `the place is read only when the app may, and only to about 10 km`() {
        val app = RuntimeEnvironment.getApplication()
        assertNull(RadioPlaces.lastKnown(app))
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        val lm = app.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        shadowOf(lm).setProviderEnabled(LocationManager.NETWORK_PROVIDER, true)
        shadowOf(lm).setLastKnownLocation(LocationManager.NETWORK_PROVIDER, Location(LocationManager.NETWORK_PROVIDER).apply {
            latitude = 45.81444; longitude = 15.97798; time = System.currentTimeMillis()
        })
        assertEquals(45.8 to 16.0, RadioPlaces.lastKnown(app))
    }
}

/** The player side: a station is never a play in history, and Previous on
 *  one always goes to the station before. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RadioPlayerTest {
    private val app = RuntimeEnvironment.getApplication()
    private val player = ExoPlayer.Builder(app).build()
    private val direct = Executor { it.run() }
    private val history = PlayHistory()

    @After fun release() = player.release()

    private fun station(n: Int) = TrackItems.toMediaItem(JSONObject()
        .put("id", "station:$n").put("source", "station").put("title", "S$n").put("streamUrl", "/api/radio/stream/$n"), "https://e")

    @Test fun `a station heard is not recorded as a play`() {
        val played = ArrayList<String>()
        var radio = 0
        val listener = QueueListener(player, recordPlay = { played.add(it.getString("id")) }, extendQueue = { radio++ })
        player.addListener(listener)
        player.setMediaItems(listOf(station(1)))
        listener.onMediaItemTransition(player.currentMediaItem, Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
        listener.onIsPlayingChanged(true)
        assertEquals(emptyList<String>(), played)
        assertEquals(0, radio)
    }

    @Test fun `Previous on a station goes to the station before, however long it has played`() {
        val level = LevelPlayer(
            player,
            Normalizer(player, GainStore(app.getSharedPreferences("radio-test", Context.MODE_PRIVATE).also { it.edit().clear().commit() }), { null }, direct, direct),
            history,
        )
        player.addListener(history.Tracker(player))
        player.setMediaItems(listOf(station(1), station(2), station(3)), 0, 0)
        player.seekTo(1, 600_000)
        level.seekToPrevious()
        assertEquals(0, player.currentMediaItemIndex)
    }
}
