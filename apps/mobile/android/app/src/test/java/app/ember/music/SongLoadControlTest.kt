package app.ember.music

import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource
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

/**
 * The playing song loads to its end, so it can finish through a dead zone;
 * the songs after it load only as far ahead as Media3 always did (50 s).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SongLoadControlTest {
    private val control = SongLoadControl().apply { onPrepared(PlayerId.UNSET) }
    private val playing = Any()
    private val after = Any()

    private fun loads(period: Any, aheadMs: Long): Boolean = control.shouldContinueLoading(
        LoadControl.Parameters(
            PlayerId.UNSET, Timeline.EMPTY, MediaSource.MediaPeriodId(period),
            0, aheadMs * 1_000, 1f, true, false, C.TIME_UNSET,
        ),
    )

    @Test fun `the playing song loads far past 50 s ahead`() {
        control.playingPeriod = playing
        assertTrue(loads(playing, 10_000))
        assertTrue(loads(playing, 60_000))
        assertTrue(loads(playing, 4 * 60_000))
        assertTrue(loads(playing, 12 * 60_000))
        assertFalse("but not without end", loads(playing, SongLoadControl.WHOLE_SONG_MS.toLong()))
    }

    @Test fun `the song after it stops 50 s ahead, as before`() {
        control.playingPeriod = playing
        assertTrue(loads(after, 10_000))
        assertFalse(loads(after, SongLoadControl.AHEAD_MS.toLong()))
        assertFalse(loads(after, 4 * 60_000))
        assertEquals(50_000, SongLoadControl.AHEAD_MS)
    }

    @Test fun `with no song known to be playing, it loads as Media3 did`() {
        assertTrue(loads(playing, 10_000))
        assertFalse(loads(playing, 60_000))
    }

    @Test fun `it follows the player's playing song`() {
        val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
        try {
            val followed = SongLoadControl()
            followed.follow(player)
            player.setMediaItems(listOf(MediaItem.fromUri("http://127.0.0.1:1/a"), MediaItem.fromUri("http://127.0.0.1:1/b")))
            shadowOf(Looper.getMainLooper()).idle()
            val first = followed.playingPeriod
            assertNotNull(first)
            assertEquals(player.currentTimeline.getUidOfPeriod(0), first)
            player.seekTo(1, 0)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(player.currentTimeline.getUidOfPeriod(1), followed.playingPeriod)
            player.clearMediaItems()
            shadowOf(Looper.getMainLooper()).idle()
            assertNull(followed.playingPeriod)
        } finally {
            player.release()
        }
    }

    @Test fun `the service's player follows its playing song with it`() {
        val loads = SongLoadControl()
        val p = EmberPlaybackService.buildPlayer(
            RuntimeEnvironment.getApplication(),
            androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(okhttp3.OkHttpClient()),
            OfflineStore(java.nio.file.Files.createTempDirectory("loads").toFile()),
            loads = loads,
        )
        try {
            p.setMediaItem(MediaItem.fromUri("http://127.0.0.1:1/a"))
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(p.currentTimeline.getUidOfPeriod(0), loads.playingPeriod)
        } finally {
            p.release()
        }
    }
}
