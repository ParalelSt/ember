package app.ember.music

import androidx.media3.common.Player
import androidx.media3.session.CommandButton
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.random.Random

/** Shuffle as a reorder of the queue (QueueShuffle), and the car's buttons
 *  that show it (CarButtons). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QueueShuffleTest {
    @Test fun `only the songs still to come are shuffled`() {
        val order = QueueShuffle.shuffledOrder(10, 3, Random(7))
        assertEquals(listOf(0, 1, 2, 3), order.take(4))
        assertEquals((4 until 10).toSet(), order.drop(4).toSet())
        assertEquals(10, order.size)
        assertEquals(emptyList<Int>(), QueueShuffle.shuffledOrder(0, 0))
        assertEquals(listOf(0), QueueShuffle.shuffledOrder(1, 0))
    }

    @Test fun `off puts the queue back in its order, keeping the song that plays`() {
        val original = listOf("a", "b", "c", "d", "e")
        val shuffled = listOf("a", "b", "e", "c", "d")
        // "e" plays (index 2); back in order it is the last song.
        val (order, at) = QueueShuffle.restoredOrder(original, shuffled, 2)
        assertEquals(original, order.map { shuffled[it] })
        assertEquals(4, at)
    }

    @Test fun `songs added while shuffled go after the original ones, removed ones stay gone`() {
        val original = listOf("a", "b", "c", "d")
        // "c" was removed, radio added "x" and "y".
        val now = listOf("a", "d", "b", "x", "y")
        val (order, at) = QueueShuffle.restoredOrder(original, now, 1)
        assertEquals(listOf("a", "b", "d", "x", "y"), order.map { now[it] })
        assertEquals(2, at)
    }

    @Test fun `a song listed twice is put back copy by copy`() {
        val original = listOf("a", "b", "a", "c")
        val now = listOf("a", "c", "a", "b")
        val (order, at) = QueueShuffle.restoredOrder(original, now, 2)
        assertEquals(listOf(0, 3, 2, 1), order)
        assertEquals(2, at)
    }

    @Test fun `the state keeps the first order across a reshuffle, and the app's own order`() {
        val s = ShuffleState()
        s.shuffled(listOf("a", "b", "c"))
        s.shuffled(listOf("a", "c", "b"))
        assertTrue(s.on)
        assertEquals(listOf("a", "b", "c"), s.original)
        s.clear()
        assertFalse(s.on)
        assertNull(s.original)
        s.setByApp(true, listOf("x", "y"))
        assertEquals(listOf("x", "y"), s.original)
        s.setByApp(false, null)
        assertNull(s.original)
    }

    @Test fun `the buttons show their state in icon and name`() {
        val off = CarButtons.layout(liked = null, shuffle = false, repeatMode = Player.REPEAT_MODE_OFF)
        assertEquals(listOf("Shuffle off", "Repeat off"), off.map { it.displayName.toString() })
        assertEquals(CommandButton.ICON_SHUFFLE_OFF, off[0].icon)
        assertEquals(CommandButton.ICON_REPEAT_OFF, off[1].icon)
        assertEquals(EmberPlaybackService.COMMAND_SHUFFLE, off[0].sessionCommand!!.customAction)

        val on = CarButtons.layout(liked = true, shuffle = true, repeatMode = Player.REPEAT_MODE_ONE)
        assertEquals(listOf("Remove from Liked songs", "Shuffle on", "Repeat one"), on.map { it.displayName.toString() })
        assertEquals(CommandButton.ICON_HEART_FILLED, on[0].icon)
        assertEquals(CommandButton.ICON_SHUFFLE_ON, on[1].icon)
        assertEquals(CommandButton.ICON_REPEAT_ONE, on[2].icon)
        assertEquals(CarButtons.COMMAND_LIKE, on[0].sessionCommand!!.customAction)
        // Legacy controllers (Android Auto, the notification before Android 13)
        // need a drawable for each.
        on.forEach { assertTrue(it.iconResId != 0) }

        assertEquals("Add to Liked songs", CarButtons.layout(false, false, Player.REPEAT_MODE_ALL)[0].displayName.toString())
        assertEquals(CommandButton.ICON_REPEAT_ALL, CarButtons.layout(false, false, Player.REPEAT_MODE_ALL)[2].icon)
    }

    @Test fun `repeat cycles off, all, one`() {
        assertEquals(Player.REPEAT_MODE_ALL, CarButtons.nextRepeat(Player.REPEAT_MODE_OFF))
        assertEquals(Player.REPEAT_MODE_ONE, CarButtons.nextRepeat(Player.REPEAT_MODE_ALL))
        assertEquals(Player.REPEAT_MODE_OFF, CarButtons.nextRepeat(Player.REPEAT_MODE_ONE))
    }

    @Test fun `liked songs are unknown until the list arrives`() {
        val l = LikedSongs()
        assertNull(l.isLiked("a"))
        l.set("a", true)
        assertNull("no guess before the list", l.isLiked("a"))
        l.replace(listOf("a"))
        assertEquals(true, l.isLiked("a"))
        assertEquals(false, l.isLiked("b"))
        l.set("b", true); l.set("a", false)
        assertEquals(true, l.isLiked("b"))
        assertEquals(false, l.isLiked("a"))
        assertNull(l.isLiked(null))
    }
}
