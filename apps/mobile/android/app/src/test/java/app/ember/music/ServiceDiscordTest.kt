package app.ember.music

import android.os.Bundle
import android.os.Looper
import android.os.Process
import androidx.media3.session.MediaSession
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.io.File
import java.time.Duration
import java.util.concurrent.TimeUnit

/** The card follows the service's player with no page anywhere: nothing in
 *  these tests is a WebView, which is the point (a locked phone, a car). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServiceDiscordTest {
    private class FakeEngine : DiscordEngine {
        val updates = mutableListOf<PresenceActivity>()
        var clears = 0
        override fun status() = DiscordStatus.Ready
        override fun update(token: Long, activity: PresenceActivity, done: (Boolean, String?, Boolean) -> Unit) {
            updates.add(activity)
            done(true, null, false)
        }
        override fun clear() { clears++ }
        override fun setPumping(on: Boolean) {}
    }

    private val app = RuntimeEnvironment.getApplication()
    private val engine = FakeEngine()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)

    @Before fun setUp() {
        DiscordEngines.override = engine
        DiscordSharing.reset()
        DiscordSharing.prefs(app).edit().clear().commit()
    }

    @After fun tearDown() {
        if (::controller.isInitialized) runCatching { controller.destroy() }
        DiscordEngines.override = null
        DiscordSharing.reset()
        MediaCache.releaseShared()
        File(app.filesDir, SavedQueue.FILE_NAME).delete()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10))

    private fun song(id: String, title: String, art: String? = "https://i.ytimg.com/vi/$id/hq.jpg") = TrackItems.toMediaItem(
        JSONObject().put("id", id).put("title", title).put("artist", "X").put("album", "LP")
            .put("artworkUrl", art ?: JSONObject.NULL).put("durationSec", 200)
            .put("streamUrl", "/api/youtube/stream/$id"),
        "http://127.0.0.1:9",
        // The car's address for the cover, which Discord cannot use.
        "app.ember.music.artwork",
    )

    private fun start() = Robolectric.buildService(EmberPlaybackService::class.java).create().also { controller = it }.get()

    @Test fun `a switch left on from before works from a cold start, with the track's details`() {
        DiscordSharing.save(app, true)
        val player = start().onGetSession(own).player
        player.setMediaItems(listOf(song("a", "First")))
        player.prepare()
        player.play()
        idle()
        val card = engine.updates.last()
        assertEquals("First", card.details)
        assertEquals("by X", card.state)
        assertEquals("LP", card.largeText)
        assertEquals("https://i.ytimg.com/vi/a/hq.jpg", card.largeImage)
        assertEquals(card.startMs + 200_000, card.endMs)
    }

    @Test fun `a song change and a pause, as from a headset, reach the card`() {
        DiscordSharing.save(app, true)
        val player = start().onGetSession(own).player
        player.setMediaItems(listOf(song("a", "First"), song("b", "Second")))
        player.prepare()
        player.play()
        idle()
        player.seekToNextMediaItem()
        idle()
        assertEquals("Second", engine.updates.last().details)
        assertEquals(0, engine.clears)
        player.pause()
        idle()
        assertEquals(1, engine.clears)
    }

    @Test fun `a seek reaches the card once the window is over`() {
        DiscordSharing.save(app, true)
        val service = start()
        var clock = 1_000_000_000L
        service.discordClock = { clock }
        val player = service.onGetSession(own).player
        player.setMediaItems(listOf(song("a", "First")))
        player.prepare()
        player.play()
        idle()
        val before = engine.updates.size
        player.seekTo(100_000)
        idle()
        assertEquals(before, engine.updates.size)
        clock += DiscordRules.RATE_LIMIT_MS + 1_000
        shadowOf(Looper.getMainLooper()).idleFor(DiscordRules.RATE_LIMIT_MS + 1_000, TimeUnit.MILLISECONDS)
        assertTrue(engine.updates.size > before)
        assertTrue(engine.updates.last().startMs < engine.updates[before - 1].startMs)
    }

    @Test fun `off by default, nothing is published and the engine stays unasked`() {
        val player = start().onGetSession(own).player
        player.setMediaItems(listOf(song("a", "First")))
        player.prepare()
        player.play()
        idle()
        assertTrue(engine.updates.isEmpty())
        assertEquals(0, engine.clears)
    }

    @Test fun `the page flipping the switch clears the card at once, and flipping it back restores it`() {
        DiscordSharing.save(app, true)
        val player = start().onGetSession(own).player
        player.setMediaItems(listOf(song("a", "First")))
        player.prepare()
        player.play()
        idle()
        DiscordSharing.save(app, false)
        idle()
        assertEquals(1, engine.clears)
        val shown = engine.updates.size
        DiscordSharing.save(app, true)
        idle()
        assertEquals(shown + 1, engine.updates.size)
    }

    @Test fun `a cover on the Ember server stays off the card`() {
        DiscordSharing.save(app, true)
        val player = start().onGetSession(own).player
        player.setMediaItems(listOf(song("a", "Upload", art = "/api/uploads/1/art")))
        player.prepare()
        player.play()
        idle()
        assertEquals("Upload", engine.updates.last().details)
        assertNull(engine.updates.last().largeImage)
    }

    @Test fun `the service going away takes the card with it`() {
        DiscordSharing.save(app, true)
        val player = start().onGetSession(own).player
        player.setMediaItems(listOf(song("a", "First")))
        player.prepare()
        player.play()
        idle()
        val clears = engine.clears
        controller.destroy()
        assertEquals(clears + 1, engine.clears)
    }
}
