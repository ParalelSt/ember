package app.ember.music

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Looper
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
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
import org.robolectric.shadows.ShadowNetworkCapabilities
import java.time.Duration

/**
 * The service as built on the phone: its cache commands (what the plugin's
 * setAutoCache, cacheStats and clearCache reach), the cache state it
 * publishes for the web UI, and the offline skip wired to the real network
 * watcher and the real cache.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServiceAutoCacheTest {
    private val app = RuntimeEnvironment.getApplication()
    private val server = MockWebServer().apply { repeat(10) { enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) } }
    private val base = server.url("/").toString().trimEnd('/')
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, 0, 0, 0, false, Bundle.EMPTY)

    private fun network(validated: Boolean) {
        val cm = app.getSystemService(ConnectivityManager::class.java)
        val caps = ShadowNetworkCapabilities.newInstance()
        shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        if (validated) shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, caps)
    }

    private fun startService() {
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        service = controller.get()
    }

    @After fun tearDown() {
        if (::controller.isInitialized) controller.destroy()
        MediaCache.releaseShared()
        runCatching { server.shutdown() }
    }

    private fun session() = service.onGetSession(own)

    private fun command(action: String, args: Bundle = Bundle.EMPTY): SessionResult {
        val f = service.Callback().onCustomCommand(session(), own, SessionCommand(action, Bundle.EMPTY), args)
        val end = System.currentTimeMillis() + 3_000
        while (!f.isDone && System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        return f.get()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))

    /** Puts a whole "song" into the service's own cache under `id`. */
    private fun cacheSong(id: String) {
        val songs = MockWebServer()
        songs.enqueue(MockResponse().setBody("x".repeat(10_000)))
        val streams = MediaCache.dataSourceFactory(MediaCache.shared(app), OkHttpDataSource.Factory(OkHttpClient()))
        AutoCacher.cacheWriterDownloads(streams).create(id, songs.url("/s").toString()).run()
        songs.shutdown()
    }

    private fun item(id: String) = TrackItems.toMediaItem(JSONObject("""{"id":"$id","title":"$id","artist":"X","streamUrl":"/s/$id"}"""), base)

    @Test fun `settings from the web app are applied and kept for the next start`() {
        network(true)
        startService()
        val r = command(EmberPlaybackService.COMMAND_AUTO_CACHE, Bundle().apply { putBoolean("enabled", false); putBoolean("onMetered", true) })
        assertEquals(SessionResult.RESULT_SUCCESS, r.resultCode)
        assertFalse(r.extras.getBoolean("enabled"))
        assertTrue(r.extras.getBoolean("onMetered"))
        val prefs = app.getSharedPreferences("ember.autoCache", Context.MODE_PRIVATE)
        assertFalse(prefs.getBoolean("enabled", true))
        assertTrue(prefs.getBoolean("onMetered", false))
    }

    @Test fun `stats and clear cover the auto cache`() {
        network(true)
        startService()
        cacheSong("youtube:a")
        cacheSong("youtube:b")
        val stats = command(EmberPlaybackService.COMMAND_CACHE_STATS).extras
        assertEquals(2, stats.getInt("count"))
        assertEquals(20_000L, stats.getLong("bytes"))
        assertEquals(300L shl 20, stats.getLong("cap"))
        val after = command(EmberPlaybackService.COMMAND_CACHE_CLEAR).extras
        assertEquals(0, after.getInt("count"))
    }

    @Test fun `the web UI learns which queued songs are on the phone`() {
        network(true)
        startService()
        cacheSong("youtube:b")
        session().player.setMediaItems(listOf(item("youtube:a"), item("youtube:b"), item("youtube:c")))
        idle()
        val extras = session().sessionExtras
        assertEquals(listOf("youtube:b"), extras.getStringArrayList(EmberPlaybackService.EXTRA_CACHED_IDS))
        assertFalse(extras.getBoolean(EmberPlaybackService.EXTRA_OFFLINE))
        assertFalse(extras.getBoolean(EmberPlaybackService.EXTRA_OFFLINE_STALLED))
    }

    @Test fun `offline, the service skips to the cached song and says it is offline`() {
        network(false)
        startService()
        cacheSong("youtube:b")
        session().player.setMediaItems(listOf(item("youtube:a"), item("youtube:b"), item("youtube:c")))
        idle()
        assertEquals(1, session().player.currentMediaItemIndex)
        assertTrue(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_OFFLINE))
    }

    @Test fun `offline with nothing on the phone, playback stalls and says so`() {
        network(false)
        startService()
        val player = session().player
        player.playWhenReady = true
        player.setMediaItems(listOf(item("youtube:a"), item("youtube:c")))
        idle()
        assertFalse(player.playWhenReady)
        assertTrue(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_OFFLINE_STALLED))
    }
}
