package app.ember.music

import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoPlayer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/** What the page and the native log hear about a player error (PlayerErrors,
 *  errorEvent): "audio: Source error" and "audio: playback error" reached
 *  the automatic bug reports with nothing else, the second one for an error
 *  that had just been cleared. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PlayerErrorsTest {
    private val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()

    @After fun release() = player.release()

    private fun refused(status: Int): PlaybackException {
        val spec = DataSpec(android.net.Uri.parse("https://ember.test/api/youtube/stream/abc"))
        val http = HttpDataSource.InvalidResponseCodeException(status, "x", null, emptyMap(), spec, ByteArray(0))
        return ExoPlaybackException.createForSource(http, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS)
    }

    private fun error(code: Int) = PlaybackException("x", null, code)

    @Test fun `the HTTP status is read from the cause, or from what a controller's copy keeps of it`() {
        assertEquals(403, PlayerErrors.httpStatus(refused(403)))
        // What a MediaController's copy of the error keeps: the first cause's
        // message only (Media3 bundles the error across the session).
        val copy = PlaybackException("Source error", android.os.RemoteException("Response code: 410"), PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS)
        assertEquals(410, PlayerErrors.httpStatus(copy))
        assertNull(PlayerErrors.httpStatus(error(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)))
    }

    @Test fun `outside failures are warnings, Ember's own stay errors`() {
        fun level(code: Int, status: Int? = null, station: Boolean = false, offline: Boolean = false) =
            PlayerErrors.level(code, status, station, offline)
        // The connection gave out.
        assertEquals("warn", level(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED))
        assertEquals("warn", level(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT))
        // The host answered: gone (410), refused (403), its own 502, signed out.
        for (status in listOf(401, 403, 404, 410, 429, 502, 503, null)) {
            assertEquals("status $status", "warn", level(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, status))
        }
        // A request Ember built wrong.
        assertEquals("error", level(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 400))
        assertEquals("error", level(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 416))
        // Offline, any load failure; online, an unexplained one is ours.
        assertEquals("warn", level(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, offline = true))
        assertEquals("error", level(PlaybackException.ERROR_CODE_IO_UNSPECIFIED))
        // A dead station: will not load, or sends something that is not audio.
        assertEquals("warn", level(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, station = true))
        assertEquals("warn", level(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, station = true))
        assertEquals("warn", level(PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE, station = true))
        // A song that will not parse or decode is a real bug, offline too.
        assertEquals("error", level(PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED))
        assertEquals("error", level(PlaybackException.ERROR_CODE_DECODING_FAILED, offline = true))
        assertEquals("error", level(PlaybackException.ERROR_CODE_DECODING_FAILED, station = true))
        assertEquals("error", level(PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED))
    }

    @Test fun `the page's error event carries the detail and the verdict`() {
        val e = errorEvent(refused(403), "youtube:abc", offline = false)!!
        assertEquals("Source error", e.getString("message"))
        assertEquals("ERROR_CODE_IO_BAD_HTTP_STATUS", e.getString("errorCodeName"))
        assertEquals(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, e.getInt("code"))
        assertEquals(403, e.getInt("httpStatus"))
        assertEquals("youtube:abc", e.getString("trackId"))
        assertFalse(e.getBoolean("station"))
        assertFalse(e.getBoolean("offline"))
        assertTrue(e.getBoolean("expected"))

        val decode = errorEvent(error(PlaybackException.ERROR_CODE_DECODING_FAILED), "youtube:abc", offline = false)!!
        assertFalse(decode.getBoolean("expected"))
        assertFalse(decode.has("httpStatus"))
    }

    @Test fun `a cleared error is no event at all`() {
        assertNull(errorEvent(null, "youtube:abc", offline = false))
    }

    /** The root cause of "audio: playback error": Media3 raises
     *  EVENT_PLAYER_ERROR when the error is CLEARED too (the next prepare()),
     *  with no error left to read, which the plugin sent on as an error. */
    @Test fun `a real player raises EVENT_PLAYER_ERROR again with no error when the next prepare clears it`() {
        val seen = mutableListOf<PlaybackException?>()
        player.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                if (events.contains(Player.EVENT_PLAYER_ERROR)) seen += player.playerError
            }
        })
        player.setMediaItem(MediaItem.fromUri("file:///nonexistent/song.m4a"))
        player.prepare()
        runUntil { seen.isNotEmpty() }
        assertNotNull("the failure itself", seen.single())
        assertNotNull(errorEvent(seen.single(), "youtube:abc", offline = false))

        player.prepare() // play pressed again, "Tap to retry"
        runUntil { seen.size >= 2 }
        assertNull("the clear", seen[1])
        assertNull(errorEvent(seen[1], "youtube:abc", offline = false))
    }

    private fun runUntil(ms: Long = 15_000, done: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end && !done()) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            Thread.sleep(5)
        }
    }
}
