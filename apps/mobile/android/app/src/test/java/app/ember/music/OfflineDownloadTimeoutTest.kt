package app.ember.music

import android.content.pm.ServiceInfo
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.nio.file.Files

/** Android 15 (targetSdk 35) gives a dataSync foreground service six hours a
 *  day. When they run out it calls onTimeout, and a service that does not
 *  stop within seconds takes the whole app down ("did not stop within its
 *  timeout"), music included: a big Liked list on a slow connection got
 *  there. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflineDownloadTimeoutTest {
    @After fun tearDown() { OfflineDownloadService.cancelled.clear() }

    @Test fun theTimeoutStopsTheServiceAtOnce() {
        val controller = Robolectric.buildService(OfflineDownloadService::class.java).create()
        val service = controller.get()

        service.onTimeout(1, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)

        assertTrue("stopped itself", shadowOf(service).isStoppedBySelf)
        assertTrue("the foreground notification is gone", shadowOf(service).isForegroundStopped)
    }

    /** The drain in flight finishes the song it is on and starts no other. */
    @Test fun aStoppedDrainStartsNoFurtherSong() {
        val store = OfflineStore(Files.createTempDirectory("offline").toFile())
        store.upsertPin("p1", "Road", listOf(
            JSONObject().put("id", "youtube:a").put("streamUrl", "http://127.0.0.1:9/a"),
            JSONObject().put("id", "youtube:b").put("streamUrl", "http://127.0.0.1:9/b"),
        ))
        var started = 0
        val client = okhttp3.OkHttpClient()
        OfflineDownloader(
            store, "http://127.0.0.1:9", client, client, Files.createTempDirectory("dl").toFile(),
            onStart = { _, _ -> started++ },
            keepGoing = { started == 0 },
        ).drain()
        assertTrue(started == 1)
        assertFalse(store.audioFileFor("youtube:b").exists())
    }
}
