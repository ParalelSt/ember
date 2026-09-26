package app.ember.music

import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The app's Previous button on a real (unprepared) ExoPlayer: the same
 *  rule as the web player, the notification and the car. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PreviousButtonTest {
    private val player = ExoPlayer.Builder(RuntimeEnvironment.getApplication()).build()
    @After fun release() = player.release()

    private fun queue() = listOf("a", "b").map {
        TrackItems.toMediaItem(JSONObject().put("id", it).put("streamUrl", "/s/$it"), "https://e")
    }

    @Test fun `a minute into a song, Previous starts it over`() {
        player.setMediaItems(queue(), 1, 60_000)
        previous(player)
        assertEquals(1, player.currentMediaItemIndex)
        assertEquals(0L, player.currentPosition)
    }

    @Test fun `in the first seconds, Previous goes to the song before`() {
        player.setMediaItems(queue(), 1, 1_000)
        previous(player)
        assertEquals(0, player.currentMediaItemIndex)
    }
}
