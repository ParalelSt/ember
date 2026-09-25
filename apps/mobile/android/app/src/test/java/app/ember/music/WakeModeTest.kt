package app.ember.music

import android.os.Looper
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager
import org.robolectric.shadows.ShadowWifiManager
import java.nio.file.Files
import java.time.Duration

/** With the screen off Android sleeps the CPU and Wi-Fi; the service's
 *  player has to hold them while it streams, and let go when paused. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WakeModeTest {
    private val app = RuntimeEnvironment.getApplication()
    private val server = MockWebServer().apply { repeat(3) { enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) } }
    private val player = EmberPlaybackService.buildPlayer(app, OkHttpDataSource.Factory(OkHttpClient()), OfflineStore(Files.createTempDirectory("wake").toFile()))

    @After fun release() {
        player.release()
        server.shutdown()
    }

    private fun held() = ShadowPowerManager.getLatestWakeLock()?.isHeld == true

    private fun runUntil(ms: Long = 3_000, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            if (done()) return true
            Thread.sleep(5)
        }
        return false
    }

    @Test fun `streaming holds the CPU awake, pausing lets it go`() {
        val track = JSONObject("""{"id":"youtube:a","title":"A","artist":"X","streamUrl":"/s/a"}""")
        player.setMediaItem(TrackItems.toMediaItem(track, server.url("/").toString().trimEnd('/')))
        player.prepare()
        player.play()
        assertTrue("wake lock held while it streams", runUntil { held() })
        player.pause()
        assertTrue("released when paused", runUntil { !held() })
        assertFalse(held())
    }
}
