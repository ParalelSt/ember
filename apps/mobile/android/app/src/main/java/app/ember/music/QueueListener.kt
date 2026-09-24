package app.ember.music

import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import org.json.JSONObject

/** What the service does as the player moves through the queue: history, the
 *  car's radio, and skipping a song that will not play. Its own class so it
 *  can be tested on a real ExoPlayer (QueueListenerTest); the service passes
 *  in the network calls.
 *
 *  Offline, the auto cache's rules (OfflinePlayback) decide instead: a
 *  network error goes to the next song that is on the phone, or pauses and
 *  flags the stall when none is ahead. The two hooks below are how this
 *  listener asks them, so a song is never skipped twice and a song skipped
 *  offline is never counted as played. */
class QueueListener(
    private val player: Player,
    private val recordPlay: (JSONObject) -> Unit,
    private val extendQueue: () -> Unit,
    /** The offline rules own this error (OfflinePlayback.handles). */
    private val offlineHandles: (PlaybackException) -> Boolean = { false },
    /** Offline, this song is skipped at once (OfflinePlayback.skips). */
    private val offlineSkips: (MediaItem) -> Boolean = { false },
) : Player.Listener {
    companion object {
        /** Songs that fail back to back before the player gives up, so a
         *  queue where nothing plays (no network, signed out) cannot spin. */
        const val MAX_ERRORS_IN_A_ROW = 5
    }

    private var errorsInARow = 0
    /** The song the player moved to that has not been heard yet. */
    private var unheard: MediaItem? = null

    /** Every song that starts is one play in history, car-initiated ones
     *  included; the web app skips its own history call on Android. But only
     *  once it is heard: a cold start hands over the saved queue paused, and
     *  counting that added a play nobody made, and fetched radio that then
     *  replaced the app's queue and dropped its playlist. */
    override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
        unheard = item
        if (player.isPlaying) heard()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (!isPlaying) return
        errorsInARow = 0
        heard()
    }

    private fun heard() {
        val item = unheard ?: return
        // Moved past offline before a note of it plays (the offline rules run
        // in their own listener, which may see this event after this one).
        if (offlineSkips(item)) return
        val track = TrackItems.trackOf(item) ?: return
        unheard = null
        recordPlay(track)
        extendQueue()
    }

    /** One song that will not play (gone from the server, a dead stream) used
     *  to stop the whole queue, in the car too, until someone touched the
     *  phone. Move on to the next one instead. A paused player stays put: the
     *  skip happens once play is pressed and the song fails again. */
    override fun onPlayerError(error: PlaybackException) {
        val failed = player.currentMediaItem?.mediaId
        if (!player.playWhenReady) return
        // No connection: the offline rules pick the next song on the phone
        // (or pause). Online, a broken song is skipped here, 404s included.
        if (offlineHandles(error)) return
        errorsInARow++
        if (errorsInARow >= MAX_ERRORS_IN_A_ROW || !player.hasNextMediaItem()) {
            Log.w(EmberPlaybackService.TAG, "gave up after $errorsInARow failed song(s), last $failed: ${error.errorCodeName}")
            // The next try (play pressed, a song picked) gets every try again.
            errorsInARow = 0
            return
        }
        Log.w(EmberPlaybackService.TAG, "skipping $failed: ${error.errorCodeName}")
        player.seekToNextMediaItem()
        player.prepare()
    }
}
