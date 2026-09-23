package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PrankOverlayTest {
    private val base = "https://ember.example"

    @Test fun capIsThirtySecondsWhateverIsAsked() {
        assertEquals(30_000L, OverlayMix.capMs(null))
        assertEquals(30_000L, OverlayMix.capMs(120.0))
        assertEquals(30_000L, OverlayMix.capMs(Double.NaN))
        assertEquals(30_000L, OverlayMix.capMs(0.0))
        assertEquals(12_500L, OverlayMix.capMs(12.5))
    }

    @Test fun playedSecondsAreRoundedAndNeverPastTheCap() {
        assertEquals(2.5, OverlayMix.playedSec(2_512, 30_000), 1e-9)
        assertEquals(30.0, OverlayMix.playedSec(31_400, 30_000), 1e-9)
        assertEquals(0.0, OverlayMix.playedSec(-5, 30_000), 1e-9)
    }

    /** The data source attaches the sign-in cookie, so only the Ember host. */
    @Test fun onlyTheEmberServerIsFetched() {
        assertEquals("$base/api/pranks/media/s1", OverlayMix.resolveUrl("/api/pranks/media/s1", base))
        assertEquals("$base/api/pranks/media/s1", OverlayMix.resolveUrl("$base/api/pranks/media/s1", base))
        assertNull(OverlayMix.resolveUrl("https://evil.example/x.mp3", base))
        assertNull(OverlayMix.resolveUrl("//evil.example/x.mp3", base))
        assertNull(OverlayMix.resolveUrl("https://ember.example.evil/x.mp3", base))
        assertNull(OverlayMix.resolveUrl("", base))
    }

    @Test fun duckScalesTheMusicAndRestoresTheOwnLevel() {
        val d = OverlayDuck(0.3)
        assertEquals(0.24f, d.start(0.8f), 1e-6f)
        assertEquals(0.8f, d.base, 1e-6f)
    }

    @Test fun ourOwnDuckedWriteIsNotANewLevel() {
        val d = OverlayDuck(0.3)
        val applied = d.start(0.8f)
        assertNull(d.onVolumeChanged(applied))
        assertEquals(0.8f, d.base, 1e-6f)
    }

    /** The slider moved while the sound played: that is the level to come back to. */
    @Test fun aVolumeChangeWhileDuckedBecomesTheNewBase() {
        val d = OverlayDuck(0.3)
        d.start(0.8f)
        assertEquals(0.15f, d.onVolumeChanged(0.5f)!!, 1e-6f)
        assertEquals(0.5f, d.base, 1e-6f)
        assertNull(d.onVolumeChanged(0.15f))
    }

    @Test fun overModeLeavesTheMusicAlone() {
        val d = OverlayDuck(1.0)
        assertEquals(0.7f, d.start(0.7f), 1e-6f)
    }

    @Test fun duckFactorIsClamped() {
        assertEquals(1f, OverlayDuck(4.0).factor, 0f)
        assertEquals(0f, OverlayDuck(-1.0).factor, 0f)
        assertEquals(0f, OverlayDuck(Double.NaN).factor, 0f)
    }

    /** Never louder than the person's own music, silent when they muted. */
    @Test fun theSoundIsAShareOfTheMusicLevel() {
        val d = OverlayDuck(0.3)
        d.start(0.8f)
        assertEquals(0.4f, d.overlayVolume(0.5), 1e-6f)
        assertEquals(0.8f, d.overlayVolume(3.0), 1e-6f)
        d.onVolumeChanged(0f)
        assertEquals(0f, d.overlayVolume(1.0), 0f)
    }

    @Test fun playArgsCarryWhatTheServiceReads() {
        val b = OverlayEvents.playArgs("p1", "/api/pranks/media/s1", 0.5, 0.3, null)
        assertEquals("p1", b.getString("id"))
        assertEquals("/api/pranks/media/s1", b.getString("url"))
        assertEquals(0.5, b.getDouble("volume"), 0.0)
        assertEquals(0.3, b.getDouble("duckTo"), 0.0)
        assertFalse(b.containsKey("maxSec"))
        assertEquals(12.0, OverlayEvents.playArgs("p1", "/x", 1.0, 1.0, 12.0).getDouble("maxSec"), 0.0)
    }

    @Test fun startedMapsToTheResolveValue() {
        val ok = OverlayEvents.startedJs(OverlayEvents.started(true))
        assertTrue(ok.getBoolean("started"))
        assertFalse(ok.has("reason"))
        val bad = OverlayEvents.startedJs(OverlayEvents.started(false, "error:load"))
        assertFalse(bad.getBoolean("started"))
        assertEquals("error:load", bad.getString("reason"))
        assertFalse(OverlayEvents.startedJs(null).getBoolean("started"))
    }

    @Test fun endedMapsToTheOverlayEvent() {
        val js = OverlayEvents.endedJs(OverlayEvents.ended("p1", "cap", 30.0))
        assertEquals("p1", js.getString("id"))
        assertEquals("ended", js.getString("phase"))
        assertEquals("cap", js.getString("reason"))
        assertEquals(30.0, js.getDouble("playedSec"), 0.0)
    }
}
