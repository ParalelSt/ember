package app.ember.music

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The web app's loop button and Media3's repeat mode, both ways. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LoopModesTest {
    @Test fun `the loop button's modes map onto Media3's repeat modes`() {
        assertEquals(Player.REPEAT_MODE_OFF, LoopModes.toRepeat("off"))
        assertEquals(Player.REPEAT_MODE_ALL, LoopModes.toRepeat("all"))
        assertEquals(Player.REPEAT_MODE_ONE, LoopModes.toRepeat("one"))
    }

    @Test fun `anything else is refused, not guessed`() {
        for (bad in listOf(null, "", "ALL", "repeat", "1")) assertNull("$bad", LoopModes.toRepeat(bad))
    }

    @Test fun `a repeat mode set from the car or notification reads back as the button's mode`() {
        assertEquals("off", LoopModes.fromRepeat(Player.REPEAT_MODE_OFF))
        assertEquals("all", LoopModes.fromRepeat(Player.REPEAT_MODE_ALL))
        assertEquals("one", LoopModes.fromRepeat(Player.REPEAT_MODE_ONE))
        assertEquals("off", LoopModes.fromRepeat(42))
    }

    @Test fun `the loop button's mode is what the auto cache window wraps on`() {
        assertEquals(AutoCachePolicy.LoopMode.OFF, LoopModes.forCache(LoopModes.toRepeat("off")!!))
        assertEquals(AutoCachePolicy.LoopMode.ALL, LoopModes.forCache(LoopModes.toRepeat("all")!!))
        assertEquals(AutoCachePolicy.LoopMode.ONE, LoopModes.forCache(LoopModes.toRepeat("one")!!))
        assertEquals(AutoCachePolicy.LoopMode.OFF, LoopModes.forCache(42))
    }

    @Test fun `round trips`() {
        for (m in listOf("off", "all", "one")) assertEquals(m, LoopModes.fromRepeat(LoopModes.toRepeat(m)!!))
    }
}
