package app.ember.music

import android.net.Uri
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.IOException
import java.nio.file.Files
import java.time.Duration

/**
 * A connection that gives out (a tunnel, a dead zone, no network at all) is
 * retried inside the player for about ten minutes, so the song keeps its
 * place and the player stays "buffering" (the service keeps its foreground)
 * and goes on by itself when the connection is back. Moving on to a song on
 * the phone is the offline rules' call, not an error's. A 4xx is final.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PatientLoadErrorsTest {
    private val spec = DataSpec(Uri.parse("https://e/s/a"))
    private fun info(e: IOException, count: Int) = LoadErrorHandlingPolicy.LoadErrorInfo(
        LoadEventInfo(1, spec, 0), MediaLoadData(C.DATA_TYPE_MEDIA), e, count,
    )
    private fun transport(code: Int) = HttpDataSource.HttpDataSourceException(IOException("down"), spec, code, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
    private fun status(code: Int) = HttpDataSource.InvalidResponseCodeException(code, null, null, emptyMap(), spec, ByteArray(0))

    @Test fun `a dropped connection waits longer each time`() {
        val policy = PatientLoadErrors()
        val e = transport(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)
        assertEquals(2_000L, policy.getRetryDelayMsFor(info(e, 1)))
        assertEquals(5_000L, policy.getRetryDelayMsFor(info(e, 2)))
        assertEquals(30_000L, policy.getRetryDelayMsFor(info(e, 9)))
        assertEquals(10_000L, policy.getRetryDelayMsFor(info(transport(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT), 3)))
        // Only the policy ends a retry: the loader never reports one early.
        assertEquals(Int.MAX_VALUE, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA))
    }

    @Test fun `a dropped connection is final after about ten minutes of waiting`() {
        val policy = PatientLoadErrors()
        val e = transport(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT)
        val waits = (1..PatientLoadErrors.TRANSPORT_TRIES).sumOf { policy.getRetryDelayMsFor(info(e, it)) }
        assertTrue("waited ${waits / 1000} s", waits in 9 * 60_000L..12 * 60_000L)
        assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(e, PatientLoadErrors.TRANSPORT_TRIES + 1)))
    }

    @Test fun `a song the server does not have is final at once, a server error after ExoPlayer's tries`() {
        val policy = PatientLoadErrors()
        assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(status(404), 1)))
        // A server error keeps ExoPlayer's own retries, and its count.
        assertEquals(1_000L, policy.getRetryDelayMsFor(info(status(503), 2)))
        assertEquals(C.TIME_UNSET, policy.getRetryDelayMsFor(info(status(503), PatientLoadErrors.OTHER_TRIES + 1)))
    }

    // The service's own player, against an address nothing listens on.

    private val app = RuntimeEnvironment.getApplication()
    private val player = EmberPlaybackService.buildPlayer(
        app, OkHttpDataSource.Factory(OkHttpClient()), OfflineStore(Files.createTempDirectory("patient").toFile()),
    )

    @After fun release() = player.release()

    private fun runFor(emulatedMs: Long, done: () -> Boolean = { false }): Boolean {
        var left = emulatedMs
        while (left > 0) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
            left -= 500
            Thread.sleep(10)
            if (done()) return true
        }
        return false
    }

    private fun startUnreachable() {
        player.setMediaItem(TrackItems.toMediaItem(JSONObject().put("id", "a").put("streamUrl", "/s/a"), "http://127.0.0.1:1"))
        player.prepare()
        player.play()
    }

    /** Past the old limit (five tries, about 70 s), which used to stop the
     *  song with an error. */
    @Test fun `the player keeps buffering the song instead of failing`() {
        startUnreachable()
        runFor(120_000)
        assertNull(player.playerError)
        assertEquals(Player.STATE_BUFFERING, player.playbackState)
        assertTrue(player.playWhenReady)
    }
}
