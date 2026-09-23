package app.ember.music

import android.content.Context
import android.media.AudioManager
import android.os.Bundle
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * A prank sound is never played into a phone call. The music keeps
 * "play" switched on through a call (Android only holds it), so that alone
 * is not "the music is playing". Real ExoPlayers under Robolectric; the call
 * is the audio focus loss Android sends when one rings.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PrankOverlayCallTest {
    private val app = RuntimeEnvironment.getApplication()
    private val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val server = MockWebServer().apply {
        // The music and the sound both "load" forever: no decoder needed.
        repeat(4) { enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) }
    }
    private val base = server.url("/").toString().trimEnd('/')
    private val music = ExoPlayer.Builder(app)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        .build()
    private val overlay = PrankOverlay(app, music, OkHttpDataSource.Factory(OkHttpClient()), base)
    private var started: Bundle? = null

    @After fun release() {
        overlay.release()
        music.release()
        server.shutdown()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))

    private fun musicPlays() {
        music.setMediaItem(MediaItem.fromUri("$base/music"))
        music.prepare()
        music.play()
        idle()
    }

    /** What Android does to the music when a call rings. */
    private fun callRings() {
        val request = shadowOf(audio).lastAudioFocusRequest
        // The listener getter is hidden from the SDK's stubs, not from Android.
        val listener = request.listener ?: request.audioFocusRequest.javaClass
            .getMethod("getOnAudioFocusChangeListener").invoke(request.audioFocusRequest) as AudioManager.OnAudioFocusChangeListener
        listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        idle()
    }

    private fun prank() = overlay.play("p1", "/api/pranks/media/s1", 1.0, 0.3, null, onStarted = { started = it }, onEnded = {})

    @Test fun `a call that rings holds the music and blocks the sound`() {
        musicPlays()
        callRings()
        assertEquals("the music is only held", true, music.playWhenReady)
        assertEquals(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, music.playbackSuppressionReason)
        prank()
        assertEquals(false, started?.getBoolean("started"))
        assertEquals("not-playing", started?.getString("reason"))
    }

    /** A call app that never asks for the music to stop (some internet calls):
     *  the phone is still in a call. */
    @Test fun `the phone being in a call blocks the sound`() {
        musicPlays()
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        prank()
        assertEquals(false, started?.getBoolean("started"))
        assertEquals("not-playing", started?.getString("reason"))
    }

    /** The feature itself is unchanged: over playing music, the sound loads. */
    @Test fun `over playing music with no call the sound goes ahead`() {
        musicPlays()
        prank()
        idle()
        assertNull("still loading, not refused", started)
    }

    @Test fun `paused music still blocks the sound`() {
        prank()
        assertEquals("not-playing", started?.getString("reason"))
    }
}
