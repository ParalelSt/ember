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

    @Test fun `the service and the updater log under one session, on one shared thread`() {
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        val service = controller.get()
        assertEquals(NativeLogThreads.session, service.playbackLog.session)
        AppUpdater.resetForTest(null, { it.run() }, baseUrl = "http://127.0.0.1:9")
        AppUpdater.init(app)
        // The updater's log has no threads of its own: a field for one would
        // show up here.
        val fields = AppUpdater::class.java.declaredFields.map { it.name }
        assertTrue(fields.toString(), fields.none { it == "logIo" || it == "logTimer" })
        // Both send on the same thread.
        val names = java.util.concurrent.CopyOnWriteArrayList<String>()
        NativeLogThreads.io.submit { names.add(Thread.currentThread().name) }.get()
        assertEquals(listOf("ember-log-io"), names)
        AppUpdater.resetForTest(null, { it.run() })
    }

    @Test fun `a stopped service drops its own timers and leaves the shared threads running`() {
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        val mine = NativeLogThreads.Timers()
        var fired = false
        mine.after(60_000) { fired = true }
        assertEquals(1, mine.pendingCount())
        mine.cancelAll()
        assertEquals(0, mine.pendingCount())
        assertTrue(runCatching { mine.after(1) {} }.isFailure)
        controller.destroy()
        // The shared threads outlive the service: the next one logs on them.
        val ran = java.util.concurrent.CountDownLatch(2)
        NativeLogThreads.io.execute { ran.countDown() }
        NativeLogThreads.Timers().after(1) { ran.countDown() }
        assertTrue(ran.await(5, java.util.concurrent.TimeUnit.SECONDS))
        assertEquals(false, fired)
    }
}
