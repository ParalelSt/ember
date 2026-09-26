package app.ember.music

import android.os.Looper
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * The service's queue listener on a real ExoPlayer. A song that cannot play
 * (a file that is gone, a stream the server refuses) must not stop the queue:
 * that is the car falling silent until someone touches the phone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QueueListenerTest {
    private val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
    private val server = MockWebServer()
    private val played = ArrayList<String>()
    private var errors = 0
    private var radio = 0
    private val listener = QueueListener(player, recordPlay = { played.add(it.getString("id")) }, extendQueue = { radio++ })

    init {
        player.addListener(listener)
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) { errors++ }
        })
    }

    @After fun release() {
        player.release()
        server.shutdown()
    }

    private fun item(id: String, uri: String) = TrackItems.toMediaItem(
        JSONObject().put("id", id).put("title", id).put("artist", "X").put("streamUrl", uri), "https://ember.test",
    )

    /** A file that does not exist: fails (after the player's own retries)
     *  like a dead stream, without a network. */
    private fun broken(id: String) = item(id, "/unused").buildUpon().setUri("file:///nonexistent/$id.m4a").build()

    /** A stream that connects and then never answers: "still loading", which
     *  is all a test without a real decoder can show of a song that plays. */
    private fun loading(id: String): MediaItem {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        return item(id, server.url("/$id").toString())
    }

    /** Lets the player's own thread work until [done], or [ms] pass. */
    private fun runUntil(ms: Long = 3_000, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            // The emulated clock only moves when told; the player's own
            // thread waits on it between steps and between its retries.
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            if (done()) return true
            Thread.sleep(5)
        }
        return false
    }

    private fun start(items: List<MediaItem>, play: Boolean = true) {
        player.setMediaItems(items)
        player.prepare()
        player.playWhenReady = play
    }

    @Test fun `a song that will not play is skipped and the next one starts`() {
        start(listOf(broken("a"), loading("b")))
        runUntil { player.currentMediaItemIndex == 1 && player.playbackState == Player.STATE_BUFFERING }
        assertEquals("the queue moved on to the next song", 1, player.currentMediaItemIndex)
        assertEquals(Player.STATE_BUFFERING, player.playbackState)
        assertTrue(player.playWhenReady)
    }

    @Test fun `several broken songs in a row are all skipped`() {
        start(listOf(broken("a"), broken("b"), broken("c"), loading("d")))
        runUntil { player.currentMediaItemIndex == 3 && player.playbackState == Player.STATE_BUFFERING }
        assertEquals(3, player.currentMediaItemIndex)
        assertEquals(3, errors)
    }

    /** Repeat-all over songs that all fail would otherwise spin forever. */
    @Test fun `a queue where nothing plays gives up after a few tries`() {
        player.repeatMode = Player.REPEAT_MODE_ALL
        start(listOf(broken("a"), broken("b"), broken("c")))
        runUntil { errors >= QueueListener.MAX_ERRORS_IN_A_ROW }
        runUntil(300) { false }
        assertEquals(QueueListener.MAX_ERRORS_IN_A_ROW, errors)
        assertEquals(Player.STATE_IDLE, player.playbackState)
    }

    @Test fun `the last song failing stops there`() {
        start(listOf(broken("a")))
        runUntil { errors == 1 }
        runUntil(300) { false }
        assertEquals(1, errors)
        assertEquals(0, player.currentMediaItemIndex)
    }

    /** A paused player (a queue restored at launch) is left where it is; the
     *  skip happens once the person presses play. */
    @Test fun `a paused player does not jump to another song`() {
        start(listOf(broken("a"), loading("b")), play = false)
        runUntil { errors == 1 }
        runUntil(300) { false }
        assertEquals(0, player.currentMediaItemIndex)
    }

    /** Giving up is not for good: pressing play again, or picking a song,
     *  gets the full number of tries again. */
    @Test fun `trying again after giving up gets every try again`() {
        player.repeatMode = Player.REPEAT_MODE_ALL
        start(listOf(broken("a"), broken("b"), broken("c")))
        runUntil { errors >= QueueListener.MAX_ERRORS_IN_A_ROW }
        runUntil(300) { false }
        player.prepare()
        runUntil { errors >= 2 * QueueListener.MAX_ERRORS_IN_A_ROW }
        runUntil(300) { false }
        assertEquals(2 * QueueListener.MAX_ERRORS_IN_A_ROW, errors)
    }

    // History and radio (A7).

    /** A cold start hands the player the saved queue, paused. Nobody played
     *  anything, so nothing goes into history and no radio is fetched: radio
     *  arriving then replaced the queue in the app and dropped its playlist. */
    @Test fun `restoring a paused queue records no play`() {
        start(listOf(item("a", "/a"), item("b", "/b")), play = false)
        runUntil(300) { false }
        assertEquals(emptyList<String>(), played)
    }

    @Test fun `restoring a paused queue on its last song fetches no radio`() {
        player.setMediaItems(listOf(item("a", "/a"), item("b", "/b")), 1, 0)
        player.prepare()
        runUntil(300) { false }
        assertEquals(0, radio)
    }

    /** Pressing play is when the song counts, once: pausing and playing again
     *  is not a second play. */
    @Test fun `a song counts once when it starts playing`() {
        start(listOf(item("a", "/a"), item("b", "/b")), play = false)
        runUntil(300) { false }
        listener.onIsPlayingChanged(true)
        listener.onIsPlayingChanged(false)
        listener.onIsPlayingChanged(true)
        assertEquals(listOf("a"), played)
    }

    /** Songs that follow on by themselves while music plays (and a song on
     *  repeat) still count every time, as before. */
    @Test fun `each song that follows on while playing counts`() {
        var playing = true
        val live = object : ForwardingPlayer(player) { override fun isPlaying() = playing }
        val l = QueueListener(live, recordPlay = { played.add(it.getString("id")) }, extendQueue = { radio++ })
        val a = item("a", "/a")
        val b = item("b", "/b")
        l.onMediaItemTransition(a, Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        l.onMediaItemTransition(b, Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        l.onMediaItemTransition(b, Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT)
        assertEquals(listOf("a", "b", "b"), played)
        // The next song has to load first: it counts once it is heard.
        playing = false
        l.onMediaItemTransition(a, Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        assertEquals(3, played.size)
        playing = true
        l.onIsPlayingChanged(true)
        assertEquals(listOf("a", "b", "b", "a"), played)
    }

    // With the auto cache's offline rules (OfflinePlayback), wired as the
    // service does: this listener first, the offline rules after it.

    /** A server that answers per song: 404 (gone), or "still loading". Also
     *  records which songs were asked for. */
    private val asked = ArrayList<String>()
    private fun serve(gone: Set<String> = emptySet()) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val id = request.path.orEmpty().trimStart('/').substringBefore('?')
                synchronized(asked) { asked.add(id) }
                return if (id in gone) MockResponse().setResponseCode(404)
                else MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            }
        }
    }
    private fun song(id: String) = item(id, server.url("/$id").toString())
    /** No server listens there: a real "connection failed", like no network. */
    private fun unreachable(id: String) = item(id, "http://127.0.0.1:1/$id")

    private fun withOfflineRules(online: () -> Boolean, onPhone: Set<String>): OfflinePlayback {
        player.removeListener(listener)
        val rules = OfflinePlayback(player, { it.mediaId in onPhone }, online)
        player.addListener(QueueListener(
            player,
            recordPlay = { played.add(it.getString("id")) },
            extendQueue = { radio++ },
            offlineHandles = rules::handles,
            offlineSkips = rules::skips,
        ))
        player.addListener(rules)
        return rules
    }

    /** Online, a song the server no longer has (404, one of the errors the
     *  offline rules also watch for) is this listener's to skip. */
    @Test fun `online, a song the server refuses is skipped`() {
        serve(gone = setOf("a"))
        withOfflineRules(online = { true }, onPhone = emptySet())
        start(listOf(song("a"), song("b")))
        runUntil(10_000) { player.currentMediaItemIndex == 1 && player.playbackState == Player.STATE_BUFFERING }
        assertEquals(1, player.currentMediaItemIndex)
        assertTrue(player.playWhenReady)
    }

    /** Offline with nothing else on the phone, the offline rules pause on the
     *  song that failed and flag the stall. This listener must not also move
     *  the queue on: that would put the stall on a song that never failed. */
    @Test fun `offline, a network error is left to the offline rules`() {
        serve()
        val rules = withOfflineRules(online = { false }, onPhone = setOf("a"))
        start(listOf(unreachable("a"), song("b")))
        runUntil(10_000) { rules.stalled }
        runUntil(300) { false }
        assertTrue(rules.stalled)
        assertEquals("paused on the song that failed", 0, player.currentMediaItemIndex)
        assertFalse(player.playWhenReady)
        assertFalse("b was never tried", synchronized(asked) { "b" in asked })
    }

    /** Offline, the rules go straight to the next song on the phone: the
     *  song in between is not loaded first (one skip, not two). */
    @Test fun `offline, a failed song goes straight to the next one on the phone`() {
        serve()
        withOfflineRules(online = { false }, onPhone = setOf("a", "c"))
        val visited = ArrayList<String>()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) { item?.let { visited.add(it.mediaId) } }
        })
        start(listOf(unreachable("a"), song("b"), song("c")))
        runUntil(10_000) { player.currentMediaItemIndex == 2 && player.playbackState == Player.STATE_BUFFERING }
        runUntil(300) { false }
        assertEquals(2, player.currentMediaItemIndex)
        assertTrue(player.playWhenReady)
        assertEquals(listOf("a", "c"), visited)
        assertFalse(synchronized(asked) { "b" in asked })
    }

    /** A song the offline rules skip is never heard, so it is not a play,
     *  even when the player reports playing in the same moment. */
    @Test fun `offline, a skipped song is not counted as played`() {
        var playing = true
        val live = object : ForwardingPlayer(player) { override fun isPlaying() = playing }
        val onPhone = setOf("a", "c")
        val rules = OfflinePlayback(live, { it.mediaId in onPhone }, { false })
        val l = QueueListener(live, recordPlay = { played.add(it.getString("id")) }, extendQueue = { radio++ },
            offlineHandles = rules::handles, offlineSkips = rules::skips)
        l.onMediaItemTransition(item("a", "/a"), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        l.onMediaItemTransition(item("b", "/b"), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        l.onIsPlayingChanged(true)
        l.onMediaItemTransition(item("c", "/c"), Player.MEDIA_ITEM_TRANSITION_REASON_SEEK)
        assertEquals(listOf("a", "c"), played)
    }

    // Online, but the connection gives out (a tunnel, a dead zone, the
    // server out of reach): not the song's fault, so it is not skipped. The
    // service's player retries for minutes first (PatientLoadErrorsTest);
    // this plain player gives up fast, which is what reaches the listener.

    @Test fun `online, a connection that gives out stays on the song instead of skipping it`() {
        serve()
        withOfflineRules(online = { true }, onPhone = emptySet())
        start(listOf(unreachable("a"), song("b")))
        runUntil(10_000) { errors >= 1 }
        runUntil(300) { false }
        assertEquals("still on the song", 0, player.currentMediaItemIndex)
        assertFalse("b was never tried", synchronized(asked) { "b" in asked })
        assertTrue("play stays on, for when the network is back", player.playWhenReady)
    }
}
