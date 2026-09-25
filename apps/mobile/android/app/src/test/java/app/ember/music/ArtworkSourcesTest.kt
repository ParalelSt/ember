package app.ember.music

import android.net.Uri
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

/**
 * Covers in the notification, on the lock screen and on the car's
 * now-playing screen. An upload's cover is a relative path on the Ember
 * server behind sign-in: it has to become absolute and be fetched with the
 * cookie. A YouTube cover is on Google's hosts: it must never get the cookie.
 * Two fake servers stand in for Ember and for a foreign host.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ArtworkSourcesTest {
    private val app = RuntimeEnvironment.getApplication()
    private val ember = MockWebServer().apply { enqueue(MockResponse().setBody("img")) }
    private val foreign = MockWebServer().apply { enqueue(MockResponse().setBody("img")) }
    private val base = ember.url("/").toString().trimEnd('/')
    private val api = ServerApi(base) { "pb_auth=secret" }
    private val factory = ArtworkSources.dataSourceFactory(app, base, OkHttpDataSource.Factory(api.http), OkHttpDataSource.Factory(OkHttpClient()))

    @After fun stop() {
        runCatching { ember.shutdown() }
        runCatching { foreign.shutdown() }
    }

    private fun fetch(url: String) {
        val source = factory.createDataSource()
        try {
            source.open(DataSpec(Uri.parse(url)))
            source.read(ByteArray(16), 0, 16)
        } finally {
            source.close()
        }
    }

    @Test fun `an upload's relative cover becomes an address on the server`() {
        val upload = JSONObject("""{"id":"upload:u1","title":"Up","artist":"Me","artworkUrl":"/api/uploads/u1/art","streamUrl":"/api/uploads/u1/stream"}""")
        val item = TrackItems.toMediaItem(upload, "https://ember.example")
        assertEquals("https://ember.example/api/uploads/u1/art", item.mediaMetadata.artworkUri.toString())
    }

    @Test fun `an absolute cover is left as it is`() {
        val yt = JSONObject("""{"id":"youtube:a","title":"A","artist":"X","artworkUrl":"https://i.ytimg.com/vi/a/hq.jpg","streamUrl":"/s/a"}""")
        assertEquals("https://i.ytimg.com/vi/a/hq.jpg", TrackItems.toMediaItem(yt, "https://ember.example").mediaMetadata.artworkUri.toString())
    }

    @Test fun `a cover on the Ember server is fetched signed in`() {
        fetch("$base/api/uploads/u1/art")
        val req = ember.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/uploads/u1/art", req.path)
        assertEquals("pb_auth=secret", req.getHeader("Cookie"))
    }

    @Test fun `a cover on another host never gets the cookie`() {
        fetch(foreign.url("/vi/a/hq.jpg").toString())
        val req = foreign.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/vi/a/hq.jpg", req.path)
        assertNull(req.getHeader("Cookie"))
    }
}
