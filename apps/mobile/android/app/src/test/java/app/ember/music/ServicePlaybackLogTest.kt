package app.ember.music

import android.os.Bundle
import android.os.Looper
import android.os.Process
import androidx.media3.session.MediaSession
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.io.File
import java.time.Duration

/** The player service logs on its own (PlaybackLog.kt): its start, and every
 *  play through the session's player with the audio focus result, with no
 *  page involved. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServicePlaybackLogTest {
    private val app = RuntimeEnvironment.getApplication()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)

    @After fun tearDown() {
        if (::controller.isInitialized) runCatching { controller.destroy() }
        MediaCache.releaseShared()
        File(app.filesDir, SavedQueue.FILE_NAME).delete()
    }

    @Test fun `a play through the session is logged with its focus result`() {
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        val service = controller.get()
        val player = service.onGetSession(own).player
        player.setMediaItem(TrackItems.toMediaItem(JSONObject("""{"id":"a","title":"A","artist":"X","streamUrl":"/api/youtube/stream/a"}"""), "http://127.0.0.1:9"))
        player.prepare()
        player.play()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10))
        val events = service.playbackLog.pending().map { it.getString("event") }
        assertEquals("service.start", events.first())
        assertTrue(events.toString(), "play.request" in events)
        assertTrue(events.toString(), "focus" in events)
        val request = service.playbackLog.pending().first { it.getString("event") == "play.request" }
        assertEquals("127.0.0.1", request.getJSONObject("data").getString("source"))
        assertEquals("phone", request.getString("surface"))
    }
}
