package app.ember.music

import android.content.Context
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A pinned playlist downloads in OfflineDownloadService with the screen
 *  off. A foreground service alone does not keep the CPU awake, so without a
 *  wake lock the download stalled as soon as the phone slept. The lock must
 *  be held while a track downloads and released once the drain is over. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DownloadWakeLockTest {
    private lateinit var server: MockWebServer
    private lateinit var ctx: Context

    @Before fun setUp() {
        ctx = RuntimeEnvironment.getApplication()
        server = MockWebServer()
        OfflineDownloadService.failed.clear()
        OfflineDownloadService.failedReason.clear()
        OfflineDownloadService.cancelled.clear()
        ShadowPowerManager.reset()
    }

    @After fun tearDown() {
        server.shutdown()
        OfflineStore.shared(ctx).clearAll()
    }

    @Test fun aWakeLockIsHeldWhileATrackDownloadsAndReleasedAfter() {
        val heldDuringDownload = arrayOfNulls<Boolean>(1)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                heldDuringDownload[0] = ShadowPowerManager.getLatestWakeLock()?.isHeld == true
                return MockResponse().setResponseCode(200).setHeader("Content-Type", "audio/mp4").setBody("AUDIO")
            }
        }
        server.start()
        val store = OfflineStore.shared(ctx)
        // Absolute stream URL: the service's own base URL is not ours to set.
        val track = JSONObject().put("id", "youtube:wl1").put("title", "T").put("artist", "A")
            .put("streamUrl", server.url("/api/youtube/stream/wl1").toString())
        store.upsertPin("p-wl", "Night", listOf(track))

        val done = CountDownLatch(1)
        OfflineDownloadService.listener = { if (it == null && store.audioFileFor("youtube:wl1").exists()) done.countDown() }
        try {
            val service = Robolectric.buildService(OfflineDownloadService::class.java).create().get()
            service.onStartCommand(null, 0, 1)
            assertTrue("download finished", done.await(10, TimeUnit.SECONDS))
            // The drain's finally runs just after the last listener call.
            val deadline = System.currentTimeMillis() + 5_000
            while (ShadowPowerManager.getLatestWakeLock()?.isHeld == true && System.currentTimeMillis() < deadline) Thread.sleep(20)
        } finally {
            OfflineDownloadService.listener = null
        }

        assertEquals("wake lock held while the track downloaded", true, heldDuringDownload[0])
        assertFalse("wake lock released after the drain", ShadowPowerManager.getLatestWakeLock()!!.isHeld)
    }
}
