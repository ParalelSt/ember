package app.ember.music

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Process
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowBinder
import java.io.File
import java.nio.file.Files

/** Covers on the Ember server, for the car (ArtworkProvider.kt): which
 *  covers become content URIs, what the provider fetches for them (with the
 *  cookie, images only), and who may read them. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ArtworkProviderTest {
    private val server = MockWebServer().apply { start() }
    private val base = server.url("/").toString().trimEnd('/')
    private val auth = "app.ember.music.artwork"
    private val dir: File = Files.createTempDirectory("car-art").toFile()
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 1, 2, 3)

    @After fun tearDown() {
        runCatching { server.shutdown() }
        ShadowBinder.reset()
    }

    private fun fetcher(downloaded: (String) -> File? = { null }): ArtworkFetcher {
        val api = ServerApi(base) { "pb_auth=secret" }
        return ArtworkFetcher(base, api.http, dir, downloaded)
    }

    private fun image(bytes: ByteArray = png) =
        MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(bytes))

    @Test fun `covers on the Ember server become content URIs, others stay as they are`() {
        assertEquals("content://$auth/upload/rec1", ArtworkUris.contentUriFor("/api/uploads/rec1/art", base, auth).toString())
        assertEquals("content://$auth/upload/rec1", ArtworkUris.contentUriFor("$base/api/uploads/rec1/art", base, auth).toString())
        assertEquals("content://$auth/playlist/p1/a_b.jpg", ArtworkUris.contentUriFor("/pb/api/files/playlists/p1/a_b.jpg", base, auth).toString())
        assertNull(ArtworkUris.contentUriFor("https://i.ytimg.com/vi/x/hq.jpg", base, auth))
        // Anything else on the server is not a cover, and never goes out.
        assertNull(ArtworkUris.contentUriFor("/api/likes", base, auth))
        assertNull(ArtworkUris.contentUriFor("/api/uploads/../history/art", base, auth))
        assertNull(ArtworkUris.contentUriFor("https://evil.example/api/uploads/rec1/art", base, auth))
    }

    @Test fun `a content URI only ever maps back to a cover path`() {
        assertEquals(ArtworkUris.Target.Server("/api/uploads/rec1/art"), ArtworkUris.targetOf(Uri.parse("content://$auth/upload/rec1")))
        assertEquals(ArtworkUris.Target.Server("/pb/api/files/playlists/p1/c.jpg"), ArtworkUris.targetOf(Uri.parse("content://$auth/playlist/p1/c.jpg")))
        assertEquals(ArtworkUris.Target.Downloaded("youtube:x"), ArtworkUris.targetOf(Uri.parse("content://$auth/track/youtube:x")))
        assertNull(ArtworkUris.targetOf(Uri.parse("content://$auth/upload/..%2F..%2Flikes")))
        assertNull(ArtworkUris.targetOf(Uri.parse("content://$auth/upload/a/b")))
        assertNull(ArtworkUris.targetOf(Uri.parse("content://$auth/api/likes")))
        assertNull(ArtworkUris.targetOf(Uri.parse("content://$auth/track/..")))
    }

    @Test fun `an upload's cover is fetched with the cookie, kept, and served from disk after`() {
        server.enqueue(image())
        val f = fetcher()
        val file = f.fileFor(Uri.parse("content://$auth/upload/rec1"))!!
        assertArrayEquals(png, file.readBytes())
        val req = server.takeRequest()
        assertEquals("/api/uploads/rec1/art", req.path)
        assertEquals("pb_auth=secret", req.getHeader("Cookie"))
        assertEquals(file, f.fileFor(Uri.parse("content://$auth/upload/rec1")))
        assertEquals("the second read comes from disk", 1, server.requestCount)
    }

    @Test fun `only images are kept, and a stale copy beats nothing when the server fails`() {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"tracks":[]}"""))
        assertNull(fetcher().fileFor(Uri.parse("content://$auth/upload/rec2")))

        server.enqueue(image())
        val f = fetcher()
        val now = System.currentTimeMillis()
        val file = f.fileFor(Uri.parse("content://$auth/upload/rec3"), now)!!
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(file, f.fileFor(Uri.parse("content://$auth/upload/rec3"), now + ArtworkFetcher.MAX_AGE_MS + 1))
    }

    @Test fun `offline, only the copy on disk is served, without a network call`() {
        server.enqueue(image())
        val now = System.currentTimeMillis()
        val kept = fetcher().fileFor(Uri.parse("content://$auth/upload/rec4"), now)!!
        val api = ServerApi(base) { "pb_auth=secret" }
        val offline = ArtworkFetcher(base, ArtworkFetcher.client(api.http), dir, { null }) { false }
        assertEquals(kept, offline.fileFor(Uri.parse("content://$auth/upload/rec4"), now + ArtworkFetcher.MAX_AGE_MS + 1))
        assertNull(offline.fileFor(Uri.parse("content://$auth/upload/never")))
        assertEquals(1, server.requestCount)
    }

    @Test fun `the fetch client keeps the cookie and gives up quickly`() {
        val api = ServerApi(base) { "pb_auth=secret" }
        val c = ArtworkFetcher.client(api.http)
        assertEquals(4_000, c.connectTimeoutMillis)
        assertEquals(6_000, c.readTimeoutMillis)
        assertEquals(api.http.interceptors.size, c.interceptors.size)
    }

    @Test fun `a downloaded song's own cover is served from the phone`() {
        val art = File(dir, "d.jpg").apply { writeBytes(png) }
        val f = fetcher { id -> art.takeIf { id == "youtube:d" } }
        assertEquals(art, f.fileFor(Uri.parse("content://$auth/track/youtube:d")))
        assertNull(f.fileFor(Uri.parse("content://$auth/track/youtube:other")))
        assertEquals(0, server.requestCount)
    }

    @Test fun `the provider is read only and refuses callers the player would refuse`() {
        val app = RuntimeEnvironment.getApplication()
        val provider = Robolectric.buildContentProvider(ArtworkProvider::class.java).create(auth).get()
        assertEquals("image/*", provider.getType(Uri.parse("content://$auth/upload/rec1")))
        assertNull(provider.getType(Uri.parse("content://$auth/other")))
        assertTrue(runCatching { provider.openFile(Uri.parse("content://$auth/upload/rec1"), "w") }.exceptionOrNull() is SecurityException)

        shadowOf(app.packageManager).installPackage(PackageInfo().apply {
            packageName = "com.example.snoop"
            applicationInfo = ApplicationInfo().apply { packageName = "com.example.snoop"; uid = 10_555 }
        })
        shadowOf(app.packageManager).setNameForUid(10_555, "com.example.snoop")
        ShadowBinder.setCallingUid(10_555)
        val refused = runCatching { provider.openFile(Uri.parse("content://$auth/upload/rec1"), "r") }.exceptionOrNull()
        assertTrue("a stranger gets nothing: $refused", refused is SecurityException)
        assertEquals(0, server.requestCount)

        // Ember itself passes the gate (and then finds nothing to serve here).
        ShadowBinder.setCallingUid(Process.myUid())
        val own = runCatching { provider.openFile(Uri.parse("content://$auth/track/none"), "r") }.exceptionOrNull()
        assertTrue("own app: $own", own is java.io.FileNotFoundException)
        // The provider starts with the process: the media button receiver
        // gets its Context from it.
        assertTrue(EmberMediaButtonReceiver.appContext != null)
    }
}
