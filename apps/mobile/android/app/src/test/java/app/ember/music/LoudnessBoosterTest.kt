package app.ember.music

import androidx.media3.exoplayer.ExoPlayer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The loudness booster while casting: the effect on the phone's audio
 *  session goes away while the TV plays, and comes back on the player's
 *  current session, at the latest boost, when the music is back. A fake
 *  effect stands in for LoudnessEnhancer. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LoudnessBoosterTest {
    private val app = RuntimeEnvironment.getApplication()
    private val player = ExoPlayer.Builder(app).build()

    @After fun release() = player.release()

    private class FakeEffect(val session: Int) : LoudnessBooster.Effect {
        var gain = 0
        var on = false
        var released = false
        override fun setTargetGain(mb: Int) { gain = mb }
        override fun setEnabled(on: Boolean) { this.on = on }
        override fun release() { released = true }
    }

    private var session = 7
    private val made = ArrayList<FakeEffect>()
    private val booster = LoudnessBooster(player, { session }) { FakeEffect(it).also { made.add(it) } }

    @Test fun `a boost opens the effect on the player's session`() {
        booster.setBoost(1.5f)
        assertEquals(1, made.size)
        assertEquals(7, made[0].session)
        assertTrue(made[0].on)
        assertEquals(LoudnessBooster.millibels(1.5f), made[0].gain)
    }

    @Test fun `casting lets go of the effect, and it comes back on the current session after`() {
        booster.setBoost(1.5f)
        val before = made.single()
        booster.setSuspended(true)
        assertTrue(booster.suspended)
        assertFalse(booster.attached)
        assertFalse(before.on)
        assertTrue(before.released)
        // Songs change on the TV: nothing is made on the phone meanwhile.
        booster.setBoost(1.25f)
        booster.setBoost(1.8f)
        assertEquals(1, made.size)
        // Back on the phone, on a new audio session: the latest boost lands there.
        session = 9
        booster.setSuspended(false)
        assertTrue(booster.attached)
        val after = made.last()
        assertEquals(2, made.size)
        assertEquals(9, after.session)
        assertTrue(after.on)
        assertEquals(LoudnessBooster.millibels(1.8f), after.gain)
    }

    @Test fun `no boost needed when casting ends, so nothing is made`() {
        booster.setSuspended(true)
        booster.setBoost(1f)
        booster.setSuspended(false)
        assertEquals(0, made.size)
        assertFalse(booster.attached)
    }

    @Test fun `an effect that will not open leaves the music playing without a boost`() {
        val b = LoudnessBooster(player, { 7 }) { throw UnsupportedOperationException("no enhancer") }
        b.setBoost(2f)
        b.setSuspended(true)
        b.setSuspended(false)
        assertFalse(b.attached)
        b.release()
    }
}
