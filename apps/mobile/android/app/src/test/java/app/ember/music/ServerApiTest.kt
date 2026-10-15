package app.ember.music

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServerApiTest {
    @Test fun sendsTheCookieAndRetriesOnceWithAFreshOne() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setBody("""{"tracks":[]}"""))
        server.start()
        var cookie = "pb_auth=old"
        val api = ServerApi(server.url("/").toString().trimEnd('/')) { cookie.also { cookie = "pb_auth=new" } }
        val json = api.getJson("/api/likes")
        assertEquals(0, json.getJSONArray("tracks").length())
        assertEquals("pb_auth=old", server.takeRequest().getHeader("Cookie"))
        assertEquals("pb_auth=new", server.takeRequest().getHeader("Cookie"))
        server.shutdown()
    }

    @Test fun recordPlayPostsTheTrackBody() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        server.start()
        val api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
        api.recordPlay(JSONObject("""{"id":"youtube:abc","title":"T"}"""))
        val req = server.takeRequest()
        assertEquals("/api/history", req.path)
        assertEquals("youtube:abc", JSONObject(req.body.readUtf8()).getJSONObject("track").getString("id"))
        server.shutdown()
    }

    /** The connection check (ConnectionHealth): any answer from the server
     *  means it can be reached, even one that is not a success. */
    @Test fun reachableIsAnyAnswerFromTheServer() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/login"))
        server.start()
        val api = ServerApi(server.url("/").toString().trimEnd('/')) { null }
        assertTrue(api.reachable())
        val req = server.takeRequest()
        assertEquals("HEAD", req.method)
        assertEquals(ServerApi.PROBE_PATH, req.path)
        assertTrue("a redirect is an answer too", api.reachable())
        server.takeRequest()
        assertEquals("the redirect was not followed", 2, server.requestCount)
        server.shutdown()
    }

    @Test fun nothingListeningIsNotReachable() {
        assertFalse(ServerApi("http://127.0.0.1:1") { null }.reachable())
    }

    /** A connection that takes the request and never answers (a mobile
     *  signal that carries nothing) is no answer, within seconds. */
    @Test fun aServerThatNeverAnswersIsNotReachable() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.NO_RESPONSE))
        server.start()
        val started = System.currentTimeMillis()
        assertFalse(ServerApi(server.url("/").toString().trimEnd('/')) { null }.reachable())
        assertTrue(System.currentTimeMillis() - started < 9_000)
        server.shutdown()
    }
}
