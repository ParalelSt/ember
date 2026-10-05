package app.ember.music

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.nio.file.Files

/** A download cut off by the process going away (the phone killed the app,
 *  an OEM's "swipe clears everything") left its list at "12/50 downloaded"
 *  for good: no failure, so no Retry, and nothing started the downloader
 *  again until some other list was pinned. The app now picks the rest up
 *  when it starts. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflineResumeTest {
    private val app: Application = RuntimeEnvironment.getApplication()
    private fun store() = OfflineStore(Files.createTempDirectory("offline").toFile())

    /** Process-wide statics other tests write too. */
    @Before @After fun clearStatics() {
        OfflineDownloadService.failed.clear()
        OfflineDownloadService.failedReason.clear()
        OfflineDownloadService.cancelled.clear()
    }

    @Test fun pendingDownloadsStartTheServiceAgain() {
        val s = store()
        s.upsertPin("p1", "Road", listOf(JSONObject().put("id", "youtube:a").put("streamUrl", "/api/youtube/stream/a")))

        OfflineDownloadService.resumePending(app, s)

        assertEquals(OfflineDownloadService::class.java.name, shadowOf(app).nextStartedService?.component?.className)
    }

    /** What this process already gave up on waits for Retry: no
     *  download notification flashing up at every start. */
    @Test fun aSongThatAlreadyFailedHereStartsNothing() {
        val s = store()
        s.upsertPin("p1", "Road", listOf(JSONObject().put("id", "youtube:a").put("streamUrl", "/api/youtube/stream/a")))
        OfflineDownloadService.failed["p1"] = java.util.Collections.synchronizedSet(hashSetOf("youtube:a"))
        try {
            OfflineDownloadService.resumePending(app, s)
            assertNull(shadowOf(app).nextStartedService)
        } finally {
            OfflineDownloadService.failed.clear()
        }
    }

    @Test fun nothingPendingStartsNothing() {
        OfflineDownloadService.resumePending(app, store())
        assertNull(shadowOf(app).nextStartedService)
    }
}
