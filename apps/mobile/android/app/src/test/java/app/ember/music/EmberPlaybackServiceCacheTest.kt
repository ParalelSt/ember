package app.ember.music

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetworkCapabilities

/** The glue between Media3, the policy and the web UI: how the service reads
 *  the player for the policy, how the network is judged, and the state the
 *  plugin hands to JS. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EmberPlaybackServiceCacheTest {
    private fun track(json: String): MediaItem = TrackItems.toMediaItem(JSONObject(json), "https://ember.test")

    @Test fun `settled means whole on disk, loaded to the end, or a full buffer`() {
        assertEquals(true, EmberPlaybackService.settled(200_000, 0, 0, wholeOnDisk = true))
        assertNull(EmberPlaybackService.settled(C.TIME_UNSET, 50_000, 50_000, wholeOnDisk = false))
        assertEquals(true, EmberPlaybackService.settled(200_000, 199_500, 10_000, wholeOnDisk = false))
        assertEquals(true, EmberPlaybackService.settled(200_000, 80_000, 45_000, wholeOnDisk = false))
        assertEquals(false, EmberPlaybackService.settled(200_000, 30_000, 8_000, wholeOnDisk = false))
    }

    @Test fun `the policy sees the absolute stream URL, and no URL for a track without one`() {
        val yt = EmberPlaybackService.policyTrack(track("""{"id":"youtube:a","title":"A","streamUrl":"/api/youtube/stream/a"}"""))
        assertEquals(AutoCachePolicy.Track("youtube:a", "https://ember.test/api/youtube/stream/a", null), yt)
        val none = EmberPlaybackService.policyTrack(track("""{"id":"upload:x","title":"X","streamUrl":null}"""))
        assertNull(none.streamUrl)
        val dead = EmberPlaybackService.policyTrack(track("""{"id":"youtube:d","title":"D","streamUrl":"/s/d","unavailableAt":"2026-09-01T00:00:00Z"}"""))
        assertEquals("2026-09-01T00:00:00Z", dead.unavailableAt)
        val alive = EmberPlaybackService.policyTrack(track("""{"id":"youtube:e","title":"E","streamUrl":"/s/e","unavailableAt":null}"""))
        assertNull(alive.unavailableAt)
    }

    @Test fun `play order follows the car's native shuffle`() {
        val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
        try {
            player.setMediaItems((0 until 4).map { track("""{"id":"t$it","title":"$it","streamUrl":"/s/$it"}""") })
            assertEquals(listOf(0, 1, 2, 3), EmberPlaybackService.playOrder(player.currentTimeline, false))
            player.setShuffleOrder(ShuffleOrder.DefaultShuffleOrder(intArrayOf(2, 0, 3, 1), 0))
            assertEquals(listOf(2, 0, 3, 1), EmberPlaybackService.playOrder(player.currentTimeline, true))
        } finally {
            player.release()
        }
    }

    @Test fun `the plugin reads cache state from the session extras`() {
        val extras = Bundle().apply {
            putStringArrayList(EmberPlaybackService.EXTRA_CACHED_IDS, arrayListOf("youtube:b", "youtube:c"))
            putBoolean(EmberPlaybackService.EXTRA_OFFLINE_STALLED, true)
            putBoolean(EmberPlaybackService.EXTRA_OFFLINE, true)
        }
        assertEquals(Triple(listOf("youtube:b", "youtube:c"), true, true), cacheState(extras))
        // Nothing published yet: nothing cached, not stalled, online.
        assertEquals(Triple(emptyList<String>(), false, false), cacheState(Bundle.EMPTY))
    }

    @Test fun `setQueue's context and baseCount become the service's queue context`() {
        val withCtx = queueContextArgs(JSONObject("""{"tracks":[],"index":0,"context":{"type":"playlist","id":"p1"},"baseCount":12}"""))
        assertEquals("playlist", withCtx.getString("contextType"))
        assertEquals(12, withCtx.getInt("baseCount"))
        val old = queueContextArgs(JSONObject("""{"tracks":[],"index":0}"""))
        assertNull(old.getString("contextType"))
        assertEquals(0, old.getInt("baseCount"))
        assertNull(queueContextArgs(JSONObject("""{"context":null,"baseCount":-3}""")).getString("contextType"))
        assertEquals(0, queueContextArgs(JSONObject("""{"context":null,"baseCount":-3}""")).getInt("baseCount"))
    }

    private fun caps(vararg c: Int): NetworkCapabilities =
        ShadowNetworkCapabilities.newInstance().also { n -> c.forEach { shadowOf(n).addCapability(it) } }

    @Test fun `online means a validated network, metered means not NOT_METERED`() {
        val wifi = NetworkWatch.stateOf(caps(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_VALIDATED, NetworkCapabilities.NET_CAPABILITY_NOT_METERED), null)
        assertEquals(NetworkWatch.State(online = true, metered = false, saveData = false), wifi)
        val captive = NetworkWatch.stateOf(caps(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_NOT_METERED), null)
        assertFalse(captive.online)
        val lte = NetworkWatch.stateOf(caps(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_VALIDATED), ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED)
        assertEquals(NetworkWatch.State(online = true, metered = true, saveData = true), lte)
        val lteNoSaver = NetworkWatch.stateOf(caps(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_VALIDATED), ConnectivityManager.RESTRICT_BACKGROUND_STATUS_WHITELISTED)
        assertFalse(lteNoSaver.saveData)
        assertEquals(NetworkWatch.State(online = false, metered = null, saveData = false), NetworkWatch.stateOf(null, null))
    }

    @Test fun `NetworkWatch asks the system each time`() {
        val app = RuntimeEnvironment.getApplication()
        val cm = app.getSystemService(ConnectivityManager::class.java)
        val watch = NetworkWatch(app) {}
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, caps(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_VALIDATED, NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
        assertEquals(NetworkWatch.State(online = true, metered = false, saveData = false), watch.current())
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, caps(NetworkCapabilities.NET_CAPABILITY_INTERNET))
        assertFalse(watch.current().online)
        watch.start(); watch.stop()
    }
}
