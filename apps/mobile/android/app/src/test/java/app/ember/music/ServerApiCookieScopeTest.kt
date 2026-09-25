package app.ember.music

import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The session cookie goes to the Ember server only (security audit
 *  2026-09-25, S3). The player plays whatever streamUrl a track carries, and
 *  any app on the phone can hand the exported player service a track, so a
 *  stream on another host used to be fetched with pb_auth attached. */
class ServerApiCookieScopeTest {
    private val ember = MockWebServer()
    private val other = MockWebServer()
    private val cookie = "pb_auth=secret-session"

    @Before fun setUp() { ember.start(); other.start() }
    @After fun tearDown() { ember.shutdown(); other.shutdown() }

    private fun api() = ServerApi(ember.url("/").toString().trimEnd('/')) { cookie }

    private fun get(api: ServerApi, url: okhttp3.HttpUrl) {
        api.http.newCall(Request.Builder().url(url).build()).execute().close()
    }

    @Test fun theEmberServerGetsTheCookie() {
        ember.enqueue(MockResponse().setBody("ok"))
        get(api(), ember.url("/api/youtube/stream/abc"))
        assertEquals(cookie, ember.takeRequest().getHeader("Cookie"))
    }

    @Test fun anotherHostNeverGetsIt() {
        other.enqueue(MockResponse().setBody("ok"))
        get(api(), other.url("/steal"))
        assertNull(other.takeRequest().getHeader("Cookie"))
    }

    @Test fun norOnThe401Retry() {
        other.enqueue(MockResponse().setResponseCode(401))
        other.enqueue(MockResponse().setBody("ok"))
        get(api(), other.url("/steal"))
        assertNull(other.takeRequest().getHeader("Cookie"))
        assertEquals(1, other.requestCount)
    }

    @Test fun sameHostOtherPortIsAnotherServer() {
        val api = api()
        assertTrue(api.isServer(ember.url("/x")))
        assertFalse(api.isServer(ember.url("/x").newBuilder().port(ember.port + 1).build()))
        assertFalse(api.isServer(ember.url("/x").newBuilder().scheme("https").build()))
        assertFalse(api.isServer(other.url("/x")))
    }
}
