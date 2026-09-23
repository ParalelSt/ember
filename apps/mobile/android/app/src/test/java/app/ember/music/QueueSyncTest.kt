package app.ember.music

import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The web app hands native a whole new queue on every change: shuffle,
 * unshuffle, a song removed, radio appended, a tap in a new list. When the
 * song that is playing is still in the new queue at the index the app asks
 * for, it must keep playing where it is. Only a different song starts over.
 * The plan is a pure decision; `apply` is checked on a real (unprepared)
 * ExoPlayer, whose position and item transitions are the thing the listener
 * hears.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QueueSyncTest {
    private fun plan(current: String, ci: Int, wanted: String, i: Int) =
        QueueSync.plan(current.map { "$it" }, ci, wanted.map { "$it" }, i)

    @Test fun `the same queue and item changes nothing`() {
        assertEquals(QueueSync.Plan.Keep, plan("abc", 1, "abc", 1))
    }

    @Test fun `the same queue with another item jumps to it`() {
        assertEquals(QueueSync.Plan.Seek(2), plan("abc", 0, "abc", 2))
    }

    @Test fun `shuffling the upcoming songs swaps only what comes after`() {
        assertEquals(QueueSync.Plan.Around(before = false, after = true, appendFrom = null), plan("abcd", 1, "abdc", 1))
    }

    @Test fun `unshuffling moves the playing song but keeps it playing`() {
        assertEquals(QueueSync.Plan.Around(before = true, after = true, appendFrom = null), plan("acbd", 1, "abcd", 2))
    }

    @Test fun `removing a song before or after the playing one keeps it playing`() {
        assertEquals(QueueSync.Plan.Around(before = true, after = false, appendFrom = null), plan("abc", 2, "bc", 1))
        assertEquals(QueueSync.Plan.Around(before = false, after = true, appendFrom = null), plan("abc", 0, "ac", 0))
    }

    @Test fun `radio or add to queue appends the new tail`() {
        assertEquals(QueueSync.Plan.Around(before = false, after = false, appendFrom = 2), plan("ab", 1, "abcd", 1))
    }

    @Test fun `a tap on the playing song in another list keeps it playing`() {
        assertEquals(QueueSync.Plan.Around(before = true, after = true, appendFrom = null), plan("xay", 1, "bcad", 2))
    }

    @Test fun `a different song, or the playing one removed, loads from the top`() {
        assertEquals(QueueSync.Plan.Load(1), plan("abc", 1, "ac", 1))
        assertEquals(QueueSync.Plan.Load(0), plan("abc", 0, "xyz", 0))
        assertEquals(QueueSync.Plan.Load(1), plan("abc", 0, "abc".reversed() + "d", 1))
        assertEquals(QueueSync.Plan.Load(0), plan("", 0, "ab", 0))
    }

    // On a real player.

    private val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
    private val transitions = ArrayList<String?>()

    @After fun release() = player.release()

    private fun items(ids: String) = ids.map { MediaItem.Builder().setMediaId("$it").setUri("https://ember.test/$it").build() }
    private fun ids() = (0 until player.mediaItemCount).joinToString("") { player.getMediaItemAt(it).mediaId }

    /** Playing [ids] at [index], 42 s in. */
    private fun playing(ids: String, index: Int) {
        player.setMediaItems(items(ids), index, 42_000)
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) { transitions.add(item?.mediaId) }
        })
    }

    private fun assertKeptPlaying(ids: String, index: Int) {
        assertEquals(ids, ids())
        assertEquals(index, player.currentMediaItemIndex)
        assertEquals(42_000L, player.currentPosition)
        assertEquals("the playing song must not start again", emptyList<String?>(), transitions)
    }

    @Test fun `shuffle keeps the song and its position`() {
        playing("abcde", 1)
        QueueSync.apply(player, items("abdec"), 1)
        assertKeptPlaying("abdec", 1)
    }

    @Test fun `unshuffle keeps the song and its position at its new index`() {
        playing("acdbe", 1)
        QueueSync.apply(player, items("abcde"), 2)
        assertKeptPlaying("abcde", 2)
    }

    @Test fun `removing another song keeps the song and its position`() {
        playing("abcd", 2)
        QueueSync.apply(player, items("acd"), 1)
        assertKeptPlaying("acd", 1)
    }

    @Test fun `an appended tail keeps the song and its position`() {
        playing("ab", 1)
        QueueSync.apply(player, items("abcd"), 1)
        assertKeptPlaying("abcd", 1)
    }

    @Test fun `a new song starts from the top`() {
        playing("abc", 0)
        QueueSync.apply(player, items("xyz"), 1)
        assertEquals("xyz", ids())
        assertEquals(1, player.currentMediaItemIndex)
        assertEquals(0L, player.currentPosition)
    }
}
