package app.ember.music

import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
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
    private val listener = QueueListener(player, recordPlay = { played.add(it.getString("id")) }, extendQueue = {})

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
}
