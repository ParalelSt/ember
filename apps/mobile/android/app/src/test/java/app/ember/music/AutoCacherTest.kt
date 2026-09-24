package app.ember.music

import android.net.Uri
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/**
 * The driver around the policy: one prefetch at a time, the server's answers
 * turned into backoff, and a download that stops mattering is cancelled. The
 * downloads are fakes that finish only when the test says so; "the executor"
 * is a list the test runs by hand, and "main" runs at once.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AutoCacherTest {
    private class FakeDownload(val id: String, val url: String) : AutoCacher.Download {
        var outcome: () -> Long = { 4_000_000 }
        var canceled = false
        override fun run(): Long {
            if (canceled) throw IOException("canceled")
            return outcome()
        }
        override fun cancel() { canceled = true }
    }

    private val cached = HashSet<String>()
    private val store = object : AutoCacher.Store {
        override val cap = MediaCache.CAP_BYTES
        override fun fullyCached() = cached.toSet()
        override fun sizes() = cached.associateWith { 4_000_000L }
    }
    private val created = ArrayList<FakeDownload>()
    private val jobs = ArrayList<Runnable>()
    private var now = 1_000_000L
    private val onCached = ArrayList<String>()
    private val queue = listOf("a", "b", "c", "d", "e", "f").map {
        AutoCachePolicy.Track("youtube:$it", "https://ember.test/api/youtube/stream/$it")
    }
    private var snap = AutoCacher.Snapshot(
        queue = queue, index = 1, loopMode = AutoCachePolicy.LoopMode.OFF, contextType = null, baseCount = 0,
        playedSec = 20.0, bufferedToEnd = true, playing = true,
        net = NetworkWatch.State(online = true, metered = false, saveData = false),
        batterySaver = false,
    )
    private var next: (FakeDownload) -> Unit = {}
    private val cacher = AutoCacher(
        store = store,
        downloads = { id, url -> FakeDownload(id, url).also { next(it); created.add(it) } },
        executor = { jobs.add(it) },
        main = { it.run() },
        clock = { now },
        snapshot = { snap },
        onCached = { onCached.add(it) },
    )

    /** Run the download the executor was handed. */
    private fun runJob() = jobs.removeAt(0).run()

    private fun answer(code: Int, headers: Map<String, List<String>> = emptyMap()): () -> Long = {
        throw HttpDataSource.InvalidResponseCodeException(code, "x", null, headers, DataSpec(Uri.parse("https://ember.test/x")), ByteArray(0))
    }

    @Test fun `prefetches the next song, never the current one, with the prefetch marker`() {
        assertEquals(AutoCachePolicy.Action.Start("youtube:c"), cacher.tick())
        assertEquals(1, created.size)
        assertEquals("https://ember.test/api/youtube/stream/c?prefetch=1", created[0].url)
        assertEquals("youtube:c", cacher.inFlight)
    }

    @Test fun `one download at a time`() {
        cacher.tick()
        assertEquals(AutoCachePolicy.Action.Idle("busy"), cacher.tick())
        assertEquals(1, created.size)
    }

    @Test fun `a finished download reports the id and the next one starts`() {
        next = { if (it.id == "youtube:c") it.outcome = { cached.add("youtube:c"); 4_000_000 } }
        cacher.tick()
        runJob()
        assertEquals(listOf("youtube:c"), onCached)
        assertEquals("youtube:d", created.last().id)
        assertEquals("youtube:d", cacher.inFlight)
    }

    @Test fun `a 429 with Retry-After backs off that long and the next id goes first`() {
        next = { d ->
            d.outcome = if (d.id == "youtube:c" && created.none { it.id == d.id }) answer(429, mapOf("retry-after" to listOf("7")))
                else ({ cached.add(d.id); 1L })
        }
        cacher.tick()
        runJob()
        assertEquals("youtube:d", created.last().id)
        runJob()
        assertEquals(AutoCachePolicy.Action.Idle("backoff", now + 7_000), cacher.lastAction)
        now += 7_000
        assertEquals(AutoCachePolicy.Action.Start("youtube:c"), cacher.tick())
    }

    @Test fun `a 503 without Retry-After waits 30 s`() {
        cached.add("youtube:d")
        next = { it.outcome = answer(503) }
        cacher.tick()
        runJob()
        assertEquals(AutoCachePolicy.Action.Idle("backoff", now + 30_000), cacher.lastAction)
    }

    @Test fun `a 410 drops the id for the session`() {
        cached.add("youtube:d")
        next = { it.outcome = answer(410) }
        cacher.tick()
        runJob()
        now += 3_600_000
        assertEquals(AutoCachePolicy.Action.Idle("nothing"), cacher.tick())
        assertEquals(1, created.size)
    }

    @Test fun `three failures drop the id`() {
        cached.add("youtube:d")
        next = { it.outcome = { throw IOException("reset") } }
        repeat(3) {
            assertEquals(AutoCachePolicy.Action.Start("youtube:c"), cacher.tick())
            runJob()
            now += 200_000
        }
        assertEquals(AutoCachePolicy.Action.Idle("nothing"), cacher.tick())
    }

    @Test fun `a skip cancels the download that left the window, and costs it no attempt`() {
        cacher.tick()
        val first = created[0]
        snap = snap.copy(index = 4, playedSec = 1.0)
        assertEquals(AutoCachePolicy.Action.Abort("youtube:c"), cacher.tick())
        assertTrue(first.canceled)
        assertNull(cacher.inFlight)
        // Its run ends (with the cancel's exception) after the fact: ignored.
        runJob()
        snap = snap.copy(index = 1, playedSec = 20.0)
        assertEquals(AutoCachePolicy.Action.Start("youtube:c"), cacher.tick())
    }

    @Test fun `turning the setting off cancels the running download`() {
        cacher.tick()
        cacher.setSettings(enabled = false, allowMetered = false)
        assertEquals(AutoCachePolicy.Action.Idle("disabled"), cacher.tick())
        assertTrue(created[0].canceled)
    }

    @Test fun `mobile data cancels unless allowed`() {
        cacher.tick()
        snap = snap.copy(net = NetworkWatch.State(online = true, metered = true, saveData = false))
        assertEquals(AutoCachePolicy.Action.Idle("metered"), cacher.tick())
        assertTrue(created[0].canceled)
        cacher.setSettings(enabled = true, allowMetered = true)
        assertEquals(AutoCachePolicy.Action.Start("youtube:c"), cacher.tick())
    }

    @Test fun `going offline cancels and waits`() {
        cacher.tick()
        snap = snap.copy(net = NetworkWatch.State(online = false, metered = null, saveData = false))
        assertEquals(AutoCachePolicy.Action.Idle("offline"), cacher.tick())
        assertTrue(created[0].canceled)
    }

    @Test fun `a pinned download in the window is never prefetched`() {
        snap = snap.copy(isLocal = { it == "youtube:c" })
        assertEquals(AutoCachePolicy.Action.Start("youtube:d"), cacher.tick())
    }

    @Test fun `nothing queued cancels`() {
        cacher.tick()
        snap = snap.copy(index = -1)
        cacher.tick()
        assertTrue(created[0].canceled)
    }

    @Test fun `server answers map onto the policy`() {
        fun err(code: Int, headers: Map<String, List<String>> = emptyMap()) =
            HttpDataSource.InvalidResponseCodeException(code, "x", null, headers, DataSpec(Uri.parse("https://e/x")), ByteArray(0))
        assertEquals(AutoCachePolicy.Result.RetryAfter(503, 12.0), AutoCacher.classify(err(503, mapOf("Retry-After" to listOf(" 12 ")))))
        assertEquals(AutoCachePolicy.Result.RetryAfter(429, null), AutoCacher.classify(err(429, mapOf("retry-after" to listOf("Wed, 21 Oct 2026 07:28:00 GMT")))))
        assertEquals(AutoCachePolicy.Result.Gone, AutoCacher.classify(err(410)))
        assertEquals(AutoCachePolicy.Result.Failed, AutoCacher.classify(err(500)))
        assertEquals(AutoCachePolicy.Result.Failed, AutoCacher.classify(IOException("reset")))
        assertEquals(AutoCachePolicy.Result.Gone, AutoCacher.classify(IOException("wrapped", err(410))))
    }

    @Test fun `the prefetch marker joins an existing query`() {
        assertEquals("https://e/s/a?prefetch=1", AutoCacher.prefetchUrl("https://e/s/a"))
        assertEquals("https://e/s/a?v=1&prefetch=1", AutoCacher.prefetchUrl("https://e/s/a?v=1"))
    }

    @Test fun `settings default to on and not on mobile data`() {
        assertTrue(cacher.enabled)
        assertFalse(cacher.allowMetered)
    }
}
