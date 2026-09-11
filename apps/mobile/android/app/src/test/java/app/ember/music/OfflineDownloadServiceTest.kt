package app.ember.music

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files

/** The download drain (OfflineDownloader, the testable half of
 *  OfflineDownloadService) against a real HTTP server. Everything the service
 *  itself adds is Android plumbing: a thread and a notification. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflineDownloadServiceTest {
    private lateinit var server: MockWebServer
    private lateinit var root: File
    private lateinit var cache: File
    private lateinit var store: OfflineStore

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        root = Files.createTempDirectory("offline").toFile()
        cache = Files.createTempDirectory("dlcache").toFile()
        store = OfflineStore(root)
        // The failure and cancel sets are process-wide statics shared with the
        // Capacitor plugin, so one test's leftovers would poison the next.
        OfflineDownloadService.failed.clear()
        OfflineDownloadService.failedReason.clear()
        OfflineDownloadService.cancelled.clear()
    }

    @After fun tearDown() {
        server.shutdown()
        OfflineDownloadService.failed.clear()
        OfflineDownloadService.failedReason.clear()
        OfflineDownloadService.cancelled.clear()
    }

    private fun baseUrl() = server.url("/").toString().trimEnd('/')

    private fun track(id: String, artworkUrl: String? = null): JSONObject =
        JSONObject().put("id", id).put("title", "T $id").put("artist", "A")
            .put("streamUrl", "/api/youtube/stream/" + id.substringAfter(':'))
            .also { if (artworkUrl != null) it.put("artworkUrl", artworkUrl) }

    private fun audio(body: String = "ID3AUDIOBYTES") =
        MockResponse().setResponseCode(200).setHeader("Content-Type", "audio/mp4").setBody(body)

    private fun downloader(
        s: OfflineStore = store,
        onStart: (OfflineStore.Pin, JSONObject) -> Unit = { _, _ -> },
    ): OfflineDownloader {
        // One plain client for both roles: the cookie interceptor is ServerApi's
        // business and has its own retry, which would blur the drain's own.
        val client = OkHttpClient()
        return OfflineDownloader(s, baseUrl(), client, client, cache, onStart)
    }

    private fun partFiles() = cache.listFiles().orEmpty().filter { it.name.endsWith(".part") }

    @Test fun aSuccessfulDownloadWritesAudioArtAndTheIndex() {
        server.enqueue(audio())
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "image/jpeg").setBody("JPEG"))
        store.upsertPin("p1", "Road", listOf(track("youtube:a", server.url("/art/a").toString())))

        downloader().drain()

        assertTrue(store.audioFileFor("youtube:a").exists())
        assertTrue(store.artFileFor("youtube:a").exists())
        assertEquals("ID3AUDIOBYTES", store.audioFileFor("youtube:a").readText())
        assertTrue(OfflineDownloadService.failed.isEmpty())
        assertEquals(emptyList<Any>(), partFiles())
        // The index on disk, not just the in-memory one: a cold start reads it.
        val reloaded = OfflineStore(root)
        assertEquals(setOf("youtube:a"), reloaded.trackFiles().keys)
        assertEquals(setOf("youtube:a"), reloaded.artFiles().keys)
    }

    /** A member upload's artworkUrl is relative (/api/uploads/<id>/art), the
     *  same shape as its streamUrl, so it has to be resolved against the
     *  server rather than skipped for not starting with "http". */
    @Test fun aRelativeArtworkUrlIsFetchedFromTheServerAndCommitted() {
        server.enqueue(audio())
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "image/jpeg").setBody("JPEGCOVER"))
        val upload = JSONObject().put("id", "upload:u1").put("title", "Mine").put("artist", "Me")
            .put("streamUrl", "/api/uploads/u1/stream").put("artworkUrl", "/api/uploads/u1/art")
        store.upsertPin("p1", "Road", listOf(upload))

        downloader().drain()

        assertEquals(2, server.requestCount)
        assertEquals("/api/uploads/u1/stream", server.takeRequest().path)
        assertEquals("/api/uploads/u1/art", server.takeRequest().path)
        assertTrue(store.artFileFor("upload:u1").exists())
        assertEquals("JPEGCOVER", store.artFileFor("upload:u1").readText())
        assertTrue(OfflineDownloadService.failed.isEmpty())
        assertEquals(emptyList<Any>(), partFiles())
        assertEquals(setOf("upload:u1"), OfflineStore(root).artFiles().keys)
    }

    /** The HTML/auth rejection still applies to a relative art URL: signed out,
     *  that path answers with the sign-in page, which is not a cover. */
    @Test fun aRelativeArtworkUrlThatLandsOnTheSignInPageCommitsNoArt() {
        server.enqueue(audio())
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/auth/sign-in"))
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "text/html").setBody("<html>sign in</html>"))
        val upload = JSONObject().put("id", "upload:u1").put("title", "Mine").put("artist", "Me")
            .put("streamUrl", "/api/uploads/u1/stream").put("artworkUrl", "/api/uploads/u1/art")
        store.upsertPin("p1", "Road", listOf(upload))

        downloader().drain()

        // The audio still counts as downloaded: art is best effort.
        assertTrue(store.audioFileFor("upload:u1").exists())
        assertFalse(store.artFileFor("upload:u1").exists())
        assertTrue(OfflineDownloadService.failed.isEmpty())
        assertEquals(emptyList<Any>(), partFiles())
    }

    @Test fun twoUnauthorizedResponsesFailTheTrackWithReasonAuth() {
        repeat(2) { server.enqueue(MockResponse().setResponseCode(401)) }
        store.upsertPin("p1", "Road", listOf(track("youtube:a")))

        downloader().drain()

        assertEquals(2, server.requestCount)
        assertEquals(setOf("youtube:a"), OfflineDownloadService.failed["p1"])
        assertEquals("auth", OfflineDownloadService.failedReason["p1"])
        assertFalse(store.audioFileFor("youtube:a").exists())
        assertEquals(emptyList<Any>(), partFiles())
    }

    /** Signed out, the server answers a stream request with a redirect to the
     *  sign-in page. OkHttp follows it to a 200, so without the content check
     *  the drain would happily save an HTML page as audio. */
    @Test fun aRedirectToTheSignInPageFailsWithReasonAuthAndNoFile() {
        repeat(2) {
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/auth/sign-in"))
            server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "text/html").setBody("<html>sign in</html>"))
        }
        store.upsertPin("p1", "Road", listOf(track("youtube:a")))

        downloader().drain()

        assertEquals("auth", OfflineDownloadService.failedReason["p1"])
        assertFalse(store.audioFileFor("youtube:a").exists())
        assertEquals(0L, store.totalBytes())
        assertEquals(emptyList<Any>(), partFiles())
    }

    @Test fun aServerErrorIsRetriedOnceAndThenSucceeds() {
        server.enqueue(MockResponse().setResponseCode(500))
        server.enqueue(audio())
        store.upsertPin("p1", "Road", listOf(track("youtube:a")))

        downloader().drain()

        assertEquals(2, server.requestCount)
        assertTrue(store.audioFileFor("youtube:a").exists())
        assertTrue(OfflineDownloadService.failed.isEmpty())
        assertNull(OfflineDownloadService.failedReason["p1"])
    }

    /** Cancel lands while the first track is in flight: its bytes are dropped
     *  rather than committed, and the drain never reaches the second track. */
    @Test fun cancellingMidDrainStopsBeforeTheNextTrackAndDropsThePartialFile() {
        server.enqueue(audio())
        server.enqueue(audio())
        store.upsertPin("p1", "Road", listOf(track("youtube:a"), track("youtube:b")))

        downloader(onStart = { pin, _ -> OfflineDownloadService.cancelled.add(pin.id) }).drain()

        assertEquals("the second track must never be requested", 1, server.requestCount)
        assertFalse(store.audioFileFor("youtube:a").exists())
        assertFalse(store.audioFileFor("youtube:b").exists())
        assertEquals("the half-written file must not be left in the cache", emptyList<Any>(), partFiles())
        // A cancelled pin is not a failed pin: nothing for the UI to report.
        assertTrue(OfflineDownloadService.failed.isEmpty())
        assertTrue(OfflineDownloadService.failedReason.isEmpty())
    }

    /** Killed mid-download and started again: the store reloaded from disk must
     *  ask for only the tracks that are still missing. */
    @Test fun aStoreReloadedFromDiskResumesOnlyPendingTracks() {
        store.upsertPin("p1", "Road", listOf(track("youtube:a"), track("youtube:b"), track("youtube:c")))
        store.commitAudio("youtube:b", File.createTempFile("aud", ".m4a").apply { writeText("already here") })

        server.enqueue(audio())
        server.enqueue(audio())
        val reloaded = OfflineStore(root)
        downloader(s = reloaded).drain()

        assertEquals(2, server.requestCount)
        assertEquals(
            listOf("/api/youtube/stream/a", "/api/youtube/stream/c"),
            listOf(server.takeRequest().path, server.takeRequest().path),
        )
        assertEquals(setOf("youtube:a", "youtube:b", "youtube:c"), reloaded.trackFiles().keys)
    }

    @Test fun aTrackThatIsAlreadyDownloadedIsNotFetchedAgain() {
        store.upsertPin("p1", "Road", listOf(track("youtube:a")))
        store.commitAudio("youtube:a", File.createTempFile("aud", ".m4a").apply { writeText("already here") })

        downloader().drain()

        assertEquals(0, server.requestCount)
        assertEquals("already here", store.audioFileFor("youtube:a").readText())
        assertTrue(OfflineDownloadService.failed.isEmpty())
    }

    @Test fun cancelSetRightAfterAudioWriteResultsInNoFailedReasonAndNoCommittedFile() {
        server.enqueue(audio())
        store.upsertPin("p1", "Road", listOf(track("youtube:a")))

        downloader(onStart = { pin, _ ->
            // Set cancel after audio is requested, simulating cancel during download
            OfflineDownloadService.cancelled.add(pin.id)
        }).drain()

        assertEquals(1, server.requestCount)
        assertFalse(store.audioFileFor("youtube:a").exists())
        assertEquals(emptyList<Any>(), partFiles())
        assertTrue(OfflineDownloadService.failed.isEmpty())
        assertTrue(OfflineDownloadService.failedReason.isEmpty())
    }

    @Test fun artRequestRedirectingToAuthLeavesNoArtFileWhileAudioIsCommitted() {
        server.enqueue(audio())
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/auth/sign-in"))
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "text/html").setBody("<html>sign in</html>"))
        store.upsertPin("p1", "Road", listOf(track("youtube:a", server.url("/art/a").toString())))

        downloader().drain()

        assertTrue(store.audioFileFor("youtube:a").exists())
        assertFalse(store.artFileFor("youtube:a").exists())
        assertEquals("ID3AUDIOBYTES", store.audioFileFor("youtube:a").readText())
        assertTrue(OfflineDownloadService.failed.isEmpty())
    }
}
