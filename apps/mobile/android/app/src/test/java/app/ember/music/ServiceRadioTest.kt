package app.ember.music

import android.os.Bundle
import android.os.Looper
import android.os.Process
import androidx.media3.common.Player
import androidx.media3.session.MediaSession
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The service's radio: one fetch at a time. A dead last song failing again
 *  (play pressed while radio was still looking) started a second fetch, so
 *  radio's songs went in twice and the second answer said the music stopped. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServiceRadioTest {
    private val app = RuntimeEnvironment.getApplication()
    private val server = MockWebServer()
    private val asked = AtomicInteger()
    private val answer = CountDownLatch(1)
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)

    @After fun tearDown() {
        answer.countDown()
        if (::controller.isInitialized) runCatching { controller.destroy() }
        MediaCache.releaseShared()
        runCatching { server.shutdown() }
    }

    private fun track(id: String) = JSONObject()
        .put("id", "youtube:$id").put("title", id).put("artist", "X").put("source", "youtube").put("sourceId", id)
        .put("streamUrl", "/api/youtube/stream/$id")

    /** A host whose radio answers r1 and r2, held until [answer] opens. */
    private fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path.orEmpty().startsWith("/api/youtube/recommended")) {
                    asked.incrementAndGet()
                    answer.await(5, TimeUnit.SECONDS)
                    val tracks = org.json.JSONArray().put(track("r1")).put(track("r2"))
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(JSONObject().put("tracks", tracks).toString())
                }
                return MockResponse().setResponseCode(404)
            }
        }
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        service = controller.get()
        val base = server.url("/").toString().trimEnd('/')
        service.api = ServerApi(base) { null }
    }

    private fun player(): Player = service.onGetSession(own).player
    private fun ids() = player().let { p -> (0 until p.mediaItemCount).map { p.getMediaItemAt(it).mediaId } }

    private fun until(done: () -> Boolean) {
        val end = System.currentTimeMillis() + 5_000
        while (!done() && System.currentTimeMillis() < end) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10))
            Thread.sleep(5)
        }
    }

    /** Lets any late work (a second fetch's answer) land. */
    private fun settle() = repeat(20) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10))
        Thread.sleep(10)
    }

    @Test fun `the dead last song failing again while radio looks starts no second fetch`() {
        start()
        val base = server.url("/").toString().trimEnd('/')
        player().setMediaItems(listOf(track("a"), track("dead")).map { TrackItems.toMediaItem(it, base) }, 1, 0)
        val heard = ArrayList<Boolean>()
        // The first failure asks radio; play pressed, the song fails again
        // before radio has answered.
        service.extendAfterFailure { heard.add(it) }
        until { asked.get() == 1 }
        service.extendAfterFailure { heard.add(it) }
        settle()
        answer.countDown()
        until { heard.size == 2 }
        settle()

        assertEquals("one fetch", 1, asked.get())
        assertEquals(listOf("youtube:a", "youtube:dead", "youtube:r1", "youtube:r2"), ids())
        assertEquals("both callers hear radio found songs", listOf(true, true), heard)
    }

    @Test fun `a failed fetch frees radio for the next try`() {
        start()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                asked.incrementAndGet()
                return MockResponse().setResponseCode(500)
            }
        }
        val base = server.url("/").toString().trimEnd('/')
        player().setMediaItems(listOf(track("a"), track("dead")).map { TrackItems.toMediaItem(it, base) }, 1, 0)
        val heard = ArrayList<Boolean>()
        service.extendAfterFailure { heard.add(it) }
        until { heard.size == 1 }
        service.extendAfterFailure { heard.add(it) }
        until { heard.size == 2 }
        assertEquals(listOf(false, false), heard)
        assertEquals(2, asked.get())
    }
}
