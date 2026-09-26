package app.ember.music

import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastState
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Songs as a cast device gets them: signed links, a content type, and a
 *  cover the TV can load without the Ember cookie. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CastSupportTest {
    private val base = "https://ember.example"
    private fun track(id: String, art: String?) = JSONObject()
        .put("id", id).put("source", id.substringBefore(':')).put("sourceId", id.substringAfter(':'))
        .put("title", "Night Drive").put("artist", "The Nulls").put("album", "Night Shift")
        .put("durationSec", 200).put("artworkUrl", art ?: JSONObject.NULL)
        .put("streamUrl", if (id.startsWith("upload:")) "/api/uploads/${id.substringAfter(':')}/stream" else "/api/youtube/stream/${id.substringAfter(':')}")
    private val yt = TrackItems.toMediaItem(track("youtube:aaaaaaaaaaa", "https://lh3.googleusercontent.com/cover"), base)
    private val up = TrackItems.toMediaItem(track("upload:rec1", "/api/uploads/rec1/art"), base)
    private fun link(id: String, art: String? = null) = CastLink("$base/s/$id?st=t", art, "audio/flac", 2_000_000_000)

    @Test fun `the sign answer is read, and junk in it is left out`() {
        val json = JSONObject("""{"origin":"$base","expiresAt":1790000000,"items":{
            "youtube:aaaaaaaaaaa":{"streamUrl":"$base/api/youtube/stream/aaaaaaaaaaa?st=a","artworkUrl":null,"contentType":"audio/mp4"},
            "upload:rec1":{"streamUrl":"$base/api/uploads/rec1/stream?st=b","artworkUrl":"$base/api/uploads/rec1/art?st=c","contentType":""},
            "upload:bad":{"streamUrl":"javascript:alert(1)","artworkUrl":null,"contentType":"audio/mp4"}}}""")
        val links = CastItems.parseSignResponse(json)
        assertEquals(setOf("youtube:aaaaaaaaaaa", "upload:rec1"), links.keys)
        assertEquals(CastLink("$base/api/youtube/stream/aaaaaaaaaaa?st=a", null, "audio/mp4", 1790000000), links["youtube:aaaaaaaaaaa"])
        assertEquals("$base/api/uploads/rec1/art?st=c", links["upload:rec1"]!!.artworkUrl)
        assertEquals(CastItems.DEFAULT_MIME, links["upload:rec1"]!!.contentType)
        assertTrue(CastItems.parseSignResponse(JSONObject("{}")).isEmpty())
    }

    @Test fun `only YouTube songs and uploads are signable`() {
        assertTrue(CastItems.signable("youtube:aaaaaaaaaaa"))
        assertTrue(CastItems.signable("upload:rec1"))
        assertFalse(CastItems.signable("jamendo:1"))
        assertFalse(CastItems.signable("upload:../x"))
    }

    @Test fun `a YouTube song goes over on its signed link, keeping its public cover`() {
        val c = CastItems.forCast(yt, link("youtube:aaaaaaaaaaa"), base)
        assertEquals("$base/s/youtube:aaaaaaaaaaa?st=t", c.localConfiguration!!.uri.toString())
        assertEquals("audio/flac", c.localConfiguration!!.mimeType)
        assertEquals("https://lh3.googleusercontent.com/cover", c.mediaMetadata.artworkUri.toString())
        assertEquals("youtube:aaaaaaaaaaa", c.mediaId)
        // The track the app needs rides along.
        assertEquals("Night Drive", TrackItems.trackOf(c)!!.getString("title"))
    }

    @Test fun `an upload's cover is the signed one, never the cookie-only one`() {
        val signed = CastItems.forCast(up, link("upload:rec1", "$base/api/uploads/rec1/art?st=z"), base)
        assertEquals("$base/api/uploads/rec1/art?st=z", signed.mediaMetadata.artworkUri.toString())
        val unsigned = CastItems.forCast(up, link("upload:rec1"), base)
        assertNull(unsigned.mediaMetadata.artworkUri)
    }

    @Test fun `without a link a song goes over as it is`() {
        assertSame(yt, CastItems.forCast(yt, null, base))
    }

    @Test fun `back on the phone a song streams with the cookie again`() {
        val back = CastItems.forLocal(CastItems.forCast(up, link("upload:rec1", "$base/art?st=z"), base), base)
        assertEquals("$base/api/uploads/rec1/stream", back.localConfiguration!!.uri.toString())
        assertEquals("$base/api/uploads/rec1/art", back.mediaMetadata.artworkUri.toString())
        assertEquals("upload:rec1", back.localConfiguration!!.customCacheKey)
    }

    @Test fun `the TV gets a music track with title, artist, album and cover`() {
        val q = CastConverter().toMediaQueueItem(CastItems.forCast(yt, link("youtube:aaaaaaaaaaa"), base))
        val info = q.media!!
        assertEquals("$base/s/youtube:aaaaaaaaaaa?st=t", info.contentId)
        assertEquals("audio/flac", info.contentType)
        assertEquals(MediaInfo.STREAM_TYPE_BUFFERED, info.streamType)
        val m = info.metadata!!
        assertEquals(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK, m.mediaType)
        assertEquals("Night Drive", m.getString(MediaMetadata.KEY_TITLE))
        assertEquals("The Nulls", m.getString(MediaMetadata.KEY_ARTIST))
        assertEquals("Night Shift", m.getString(MediaMetadata.KEY_ALBUM_TITLE))
        assertEquals("https://lh3.googleusercontent.com/cover", m.images.single().url.toString())
        assertTrue(q.autoplay)
        // Small: only the id rides along, not the whole track.
        assertEquals("""{"id":"youtube:aaaaaaaaaaa"}""", info.customData.toString())
    }

    @Test fun `an item the TV has but the phone never sent is rebuilt from what the TV has`() {
        val q = CastConverter().toMediaQueueItem(CastItems.forCast(up, link("upload:rec1"), base))
        val item = CastConverter().toMediaItem(q)
        assertEquals("upload:rec1", item.mediaId)
        assertEquals("$base/s/upload:rec1?st=t", item.localConfiguration!!.uri.toString())
        val t = TrackItems.trackOf(item)!!
        assertEquals("Night Drive", t.getString("title"))
        assertEquals("/api/uploads/rec1/stream", t.getString("streamUrl"))
        assertEquals("upload", t.getString("source"))
    }

    @Test fun `the options use the Default Media Receiver and leave the media session to Media3`() {
        val o = EmberCastOptions().getCastOptions(RuntimeEnvironment.getApplication())
        assertEquals(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID, o.receiverApplicationId)
        assertFalse(o.castMediaOptions!!.mediaSessionEnabled)
        assertNull(o.castMediaOptions!!.notificationOptions)
        assertTrue(o.stopReceiverApplicationWhenEndingSession)
    }

    @Test fun `links are reused with an hour or more left, and asked for again after`() {
        var now = 1_000L
        val asked = ArrayList<List<String>>()
        val signer = CastSigner({ ids -> asked.add(ids); ids.associateWith { CastLink("https://x/$it", null, "audio/mp4", now + 6 * 3600) } }, { now })
        assertEquals(listOf("youtube:aaaaaaaaaaa", "upload:rec1"), signer.missing(listOf("youtube:aaaaaaaaaaa", "upload:rec1", "jamendo:1", "upload:rec1")))
        signer.sign(listOf("youtube:aaaaaaaaaaa", "upload:rec1"))
        assertTrue(signer.missing(listOf("youtube:aaaaaaaaaaa")).isEmpty())
        now += 5 * 3600 - 1
        assertTrue(signer.fresh("youtube:aaaaaaaaaaa") != null)
        now += 2
        assertNull(signer.fresh("youtube:aaaaaaaaaaa"))
        assertEquals(listOf("youtube:aaaaaaaaaaa"), signer.missing(listOf("youtube:aaaaaaaaaaa")))
    }

    @Test fun `links are forgotten when a session ends`() {
        val signer = CastSigner({ ids -> ids.associateWith { CastLink("https://x/$it", null, "audio/mp4", Long.MAX_VALUE) } })
        signer.sign(listOf("youtube:aaaaaaaaaaa"))
        signer.clear()
        assertEquals(listOf("youtube:aaaaaaaaaaa"), signer.missing(listOf("youtube:aaaaaaaaaaa")))
    }

    @Test fun `a long queue is signed in calls of at most 500`() {
        val sizes = ArrayList<Int>()
        val signer = CastSigner({ ids -> sizes.add(ids.size); emptyMap() })
        signer.sign((0 until 1200).map { "upload:r$it" })
        assertEquals(listOf(500, 500, 200), sizes)
    }

    @Test fun `the Cast button state for the web app`() {
        val none = castStateJs(CastState.NO_DEVICES_AVAILABLE, "TV")
        assertFalse(none.getBoolean("available"))
        val around = castStateJs(CastState.NOT_CONNECTED, "TV")
        assertTrue(around.getBoolean("available"))
        assertFalse(around.getBoolean("connected"))
        assertTrue(around.isNull("deviceName"))
        assertTrue(castStateJs(CastState.CONNECTING, null).getBoolean("connecting"))
        val on = castStateJs(CastState.CONNECTED, "Living Room TV")
        assertTrue(on.getBoolean("connected"))
        assertEquals("Living Room TV", on.getString("deviceName"))
    }

    @Test fun `castLinks posts the ids with the cookie and reads the answer`() {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("""{"expiresAt":1790000000,"items":{"youtube:aaaaaaaaaaa":{"streamUrl":"https://h/s?st=1","artworkUrl":null,"contentType":"audio/mp4"}}}"""))
        server.start()
        val api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
        val links = api.castLinks(listOf("youtube:aaaaaaaaaaa"))
        assertEquals("https://h/s?st=1", links["youtube:aaaaaaaaaaa"]!!.streamUrl)
        val req = server.takeRequest()
        assertEquals("/api/cast/sign", req.path)
        assertEquals("pb_auth=x", req.getHeader("Cookie"))
        assertEquals("youtube:aaaaaaaaaaa", JSONObject(req.body.readUtf8()).getJSONArray("ids").getString(0))
        server.shutdown()
    }
}
