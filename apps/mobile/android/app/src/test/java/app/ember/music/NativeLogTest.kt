package app.ember.music

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** NativeLog is process-wide state, so every case resets it first. Robolectric
 *  is here for a real org.json (the JVM stub returns null from every method). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeLogTest {
    private val delivered = mutableListOf<JSONObject>()
    /** Stands in for the plugin's sink; `accepting = false` is the WebView
     *  with no listener attached yet. */
    private var accepting = true
    private val sink: (JSONObject) -> Boolean = { e -> if (!accepting) false else { delivered.add(e); true } }

    @Before fun setUp() { NativeLog.reset(); delivered.clear(); accepting = true }
    @After fun tearDown() { NativeLog.reset() }

    private fun messages() = delivered.map { it.getString("message") }

    @Test fun eventsRaisedBeforeAnySinkAreDeliveredOnAttach() {
        NativeLog.error("offline", "download failed: auth")
        NativeLog.info("service", "download service started")
        assertEquals(emptyList<String>(), messages())

        NativeLog.attach(sink)
        assertEquals(listOf("download failed: auth", "download service started"), messages())

        // Once attached, later events go straight through.
        NativeLog.warn("offline", "pin rejected: id required")
        assertEquals(3, delivered.size)
        assertEquals("pin rejected: id required", delivered[2].getString("message"))
    }

    @Test fun theBufferKeepsTheNewestHundred() {
        for (i in 1..150) NativeLog.error("offline", "e$i")
        NativeLog.attach(sink)
        assertEquals(NativeLog.MAX_BUFFERED, delivered.size)
        assertEquals("e51", delivered.first().getString("message"))
        assertEquals("e150", delivered.last().getString("message"))
    }

    @Test fun eventsStayBufferedWhileTheSinkRefusesThemAndArriveInOrderLater() {
        accepting = false
        NativeLog.attach(sink)
        NativeLog.error("offline", "first")
        NativeLog.error("offline", "second")
        assertEquals(emptyList<String>(), messages())

        // The WebView subscribes: the plugin re-attaches, which drains.
        accepting = true
        NativeLog.attach(sink)
        assertEquals(listOf("first", "second"), messages())
    }

    @Test fun anEventCarriesLevelCategoryTimestampAndOptionalData() {
        NativeLog.attach(sink)
        val before = System.currentTimeMillis()
        NativeLog.error("offline", "download failed: storage", JSONObject().put("pinId", "p1"))

        val e = delivered.single()
        assertEquals("error", e.getString("level"))
        assertEquals("offline", e.getString("category"))
        assertEquals("p1", e.getJSONObject("data").getString("pinId"))
        assertEquals(true, e.getLong("ts") >= before)
    }

    @Test fun detachingStopsDeliveryAndStartsBufferingAgain() {
        NativeLog.attach(sink)
        NativeLog.info("service", "started")
        NativeLog.detach(sink)
        NativeLog.error("offline", "download failed: http")
        assertEquals(listOf("started"), messages())

        NativeLog.attach(sink)
        assertEquals(listOf("started", "download failed: http"), messages())
    }
}
