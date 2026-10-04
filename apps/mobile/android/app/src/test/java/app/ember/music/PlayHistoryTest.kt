package app.ember.music

import android.content.Context
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.Executor

/** Previous follows what was actually played (PlayHistory). Reported on
 *  0.7.15: "when tapping on a song in an auto generated queue, the previous
 *  song button leads you to a song previous on the list in the queue but not
 *  the previous song you actually played". The decision on its own first,
 *  then on a real (unprepared) ExoPlayer behind the session's LevelPlayer,
 *  which every Previous reaches (the app, the notification, the lock screen,
 *  Bluetooth, the car), and behind the cast queue. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PlayHistoryTest {
    private val app = RuntimeEnvironment.getApplication()
    private val player = ExoPlayer.Builder(app).build()
    private val direct = Executor { it.run() }
    private val history = PlayHistory()
    private val level = LevelPlayer(
        player,
        Normalizer(
            player,
            GainStore(app.getSharedPreferences("history-test", Context.MODE_PRIVATE).also { it.edit().clear().commit() }),
            { null }, direct, direct,
        ),
        history,
    )

    init {
        player.addListener(history.Tracker(player))
    }

    @After fun release() = player.release()

    private fun item(id: String) = TrackItems.toMediaItem(JSONObject().put("id", id).put("streamUrl", "/s/$id"), "https://e")
    private fun items(vararg ids: String) = ids.map(::item)
    private val abcd = listOf("a", "b", "c", "d")

    // ── The decision ────────────────────────────────────────────────────

    @Test fun `after a tap further down, Previous goes back to the song played before`() {
        val h = PlayHistory()
        h.played("a") // a was playing, d was tapped
        assertEquals(PlayHistory.Move.To(0), h.previous(abcd, 3, 0))
        assertEquals(emptyList<String>(), h.ids)
    }

    @Test fun `past 3 s Previous starts the song over and keeps the history`() {
        val h = PlayHistory()
        h.played("a")
        assertEquals(PlayHistory.Move.Restart, h.previous(abcd, 3, 3_001))
        assertEquals(listOf("a"), h.ids)
        assertEquals(PlayHistory.Move.To(0), h.previous(abcd, 3, 3_000))
    }

    @Test fun `played in order, the history is the songs above`() {
        val h = PlayHistory()
        h.played("a")
        h.played("b")
        assertEquals(PlayHistory.Move.To(1), h.previous(abcd, 2, 0))
        assertEquals(PlayHistory.Move.To(0), h.previous(abcd, 1, 0))
        assertEquals(PlayHistory.Move.Default, h.previous(abcd, 0, 0))
    }

    @Test fun `songs no longer in the queue, or the one playing, are skipped`() {
        val h = PlayHistory()
        h.played("a")
        h.played("gone")
        h.played("d")
        assertEquals(PlayHistory.Move.To(0), h.previous(abcd, 3, 0))
        assertEquals(emptyList<String>(), h.ids)
    }

    @Test fun `a song in the queue twice goes to the copy nearest the current one`() {
        val h = PlayHistory()
        h.played("a")
        assertEquals(PlayHistory.Move.To(3), h.previous(listOf("a", "b", "c", "a", "d"), 4, 0))
    }

    @Test fun `the stack keeps only the newest songs`() {
        val h = PlayHistory(max = 3)
        listOf("a", "b", "c", "d").forEach(h::played)
        assertEquals(listOf("b", "c", "d"), h.ids)
    }

    @Test fun `the tracker counts a natural advance, not a repeat, and a new queue clears`() {
        val h = PlayHistory()
        val t = h.Tracker(player)
        t.onMediaItemTransition(item("a"), Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
        t.onMediaItemTransition(item("b"), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        t.onMediaItemTransition(item("b"), Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT)
        assertEquals(listOf("a"), h.ids)
        t.onMediaItemTransition(item("x"), Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
        assertEquals(emptyList<String>(), h.ids)
    }

    @Test fun `a song that failed before a note of it played is not gone back to`() {
        // a plays, Next to x, which will not load, and the player skips it to
        // b (QueueListener). Previous from b went to x, which failed and was
        // skipped forward to b again, and pushed x again: Previous could
        // never get back past a dead song to a.
        val h = PlayHistory()
        val t = h.Tracker(player)
        t.onMediaItemTransition(item("a"), Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
        t.onIsPlayingChanged(true)
        t.onMediaItemTransition(item("x"), Player.MEDIA_ITEM_TRANSITION_REASON_SEEK)
        t.onIsPlayingChanged(false)
        t.onPlayerError(PlaybackException("410", null, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
        t.onMediaItemTransition(item("b"), Player.MEDIA_ITEM_TRANSITION_REASON_SEEK)
        assertEquals(listOf("a"), h.ids)
        assertEquals(PlayHistory.Move.To(0), h.previous(listOf("a", "x", "b"), 2, 0))
    }

    @Test fun `a song that played and then failed is still history`() {
        val h = PlayHistory()
        val t = h.Tracker(player)
        t.onMediaItemTransition(item("a"), Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
        t.onIsPlayingChanged(true)
        t.onPlayerError(PlaybackException("dropped", null, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
        t.onMediaItemTransition(item("b"), Player.MEDIA_ITEM_TRANSITION_REASON_SEEK)
        assertEquals(listOf("a"), h.ids)
    }

    @Test fun `a song that failed and then played after a retry is history`() {
        val h = PlayHistory()
        val t = h.Tracker(player)
        t.onMediaItemTransition(item("x"), Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
        t.onPlayerError(PlaybackException("503", null, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
        t.onIsPlayingChanged(true)
        t.onMediaItemTransition(item("b"), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO)
        assertEquals(listOf("x"), h.ids)
    }

    // ── On the player ───────────────────────────────────────────────────

    @Test fun `a tap in the queue, then Previous, returns to the song played before`() {
        player.setMediaItems(items("a", "b", "c", "d"), 0, 0)
        player.seekTo(3, 0) // the tap (QueueSync's Seek)
        level.seekToPrevious()
        assertEquals(0, player.currentMediaItemIndex)
        // Going back pushed nothing: no bouncing back to d.
        assertEquals(emptyList<String>(), history.ids)
    }

    @Test fun `with no history Previous passes over a song that failed before it played`() {
        player.setMediaItems(items("a", "x", "b"), 1, 0)
        // x will not load; the player skips it (QueueListener).
        history.Tracker(player).onPlayerError(PlaybackException("410", null, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
        player.seekTo(2, 0)
        assertEquals(emptyList<String>(), history.ids)
        level.seekToPrevious()
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test fun `past 3 s it restarts, then the next press goes back`() {
        player.setMediaItems(items("a", "b", "c", "d"), 0, 0)
        player.seekTo(3, 60_000)
        level.seekToPrevious()
        assertEquals(3, player.currentMediaItemIndex)
        assertEquals(0L, player.currentPosition)
        level.seekToPrevious()
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test fun `played in order, Previous is the song above, again and again`() {
        player.setMediaItems(items("a", "b", "c", "d"), 0, 0)
        player.seekToNextMediaItem()
        player.seekToNextMediaItem()
        level.seekToPrevious()
        assertEquals(1, player.currentMediaItemIndex)
        level.seekToPrevious()
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test fun `with no history Previous walks up the queue without bouncing`() {
        player.setMediaItems(items("a", "b", "c", "d"), 3, 0)
        level.seekToPrevious()
        assertEquals(2, player.currentMediaItemIndex)
        level.seekToPrevious()
        assertEquals(1, player.currentMediaItemIndex)
    }

    @Test fun `a new queue starts a fresh history`() {
        player.setMediaItems(items("a", "b", "c", "d"), 0, 0)
        player.seekTo(3, 0) // history: a
        player.setMediaItems(items("c", "a", "d", "b"), 3, 0) // another list, b tapped
        level.seekToPrevious()
        // The song above in the new list, not a from the old queue.
        assertEquals(2, player.currentMediaItemIndex)
    }

    @Test fun `previous item asked for directly follows the history too`() {
        player.setMediaItems(items("a", "b", "c", "d"), 0, 0)
        player.seekTo(3, 60_000)
        level.seekToPreviousMediaItem()
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test fun `while casting the TV's queue follows its own history`() {
        val tv = ExoPlayer.Builder(app).build()
        try {
            val castHistory = PlayHistory()
            val signer = CastSigner({ ids -> ids.associateWith { CastLink("https://e/signed/$it", null, "audio/mp4", System.currentTimeMillis() / 1000 + 3600) } })
            val queue = CastQueuePlayer(tv, signer, "https://e", direct, direct, castHistory)
            queue.addListener(castHistory.Tracker(queue))
            queue.setMediaItems(items("a", "b", "c", "d"), 0, 0)
            queue.seekTo(3, 0)
            queue.seekToPrevious()
            assertEquals(0, tv.currentMediaItemIndex)
        } finally {
            tv.release()
        }
    }
}
