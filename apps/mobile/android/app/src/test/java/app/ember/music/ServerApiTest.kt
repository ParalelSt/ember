package app.ember.music

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
}
