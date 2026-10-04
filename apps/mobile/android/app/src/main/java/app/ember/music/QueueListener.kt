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
    /** A song that would not play, and what was done about it: the web app
     *  says which song and why, and greys it in the queue
     *  (UnplayableNotices). Before, the only trace was a logcat line. */
    private val onUnplayable: (UnplayableNotice) -> Unit = {},
    /** The LAST song failed: ask radio for more, and call back with whether
     *  it added any. False when radio will not try (repeat on, not a YouTube
     *  song). Radio used to run only once a song was heard, so a dead song
     *  at the end of the queue stopped the music with no word. */
    private val extendAfterFailure: (done: (Boolean) -> Unit) -> Boolean = { false },
    /** The song last counted, shared by the phone's listener and the TV's:
     *  casting hands the playing song from one player to the other. */
    private val lastHeard: LastHeard = LastHeard(),
) : Player.Listener {
    /** The id of the song last counted as a play (see [lastHeard]). */
    class LastHeard {
        @Volatile var id: String? = null
    }

    companion object {
        /** Songs that fail back to back before the player gives up, so a
         *  queue where nothing plays (no network, signed out) cannot spin. */
        const val MAX_ERRORS_IN_A_ROW = 5
        /** The connection gave out, not the song: the phone could not reach
         *  the server at all, or it stopped answering. */
        val TRANSPORT_ERRORS = setOf(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        )
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
        // The song already counted, handed over to another player (casting
        // starting or ending sets the same queue on it, at the song and the
        // place it had reached): the same play going on, not a new one. A
        // song picked again from its start (position 0) is a new play.
        val handedOver = reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED &&
            item != null && item.mediaId == lastHeard.id && player.currentPosition > 0
        unheard = if (handedOver) null else item
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
        lastHeard.id = item.mediaId
        recordPlay(track)
        extendQueue()
    }

    /** One song that will not play (gone from the server, a dead stream) used
     *  to stop the whole queue, in the car too, until someone touched the
     *  phone. Move on to the next one instead. A paused player stays put: the
     *  skip happens once play is pressed and the song fails again. */
    override fun onPlayerError(error: PlaybackException) {
        val item = player.currentMediaItem
        val failed = item?.mediaId
        if (!player.playWhenReady) return
        // No connection: the offline rules pick the next song on the phone
        // (or pause). Online, a broken song is skipped here, 404s included.
        if (offlineHandles(error)) return
        // The phone says it is online, but the connection gave out: a weak
        // signal (a tunnel, a dead zone, which does not make Android drop
        // the network) or the server out of reach. That is not the song's
        // fault, and skipping burned through the queue, a song per outage,
        // then stopped. The player has already kept trying for minutes
        // (PatientLoadErrors); it stops on this song, and play, or the
        // network coming back (OfflinePlayback.onNetwork), picks it up.
        if (error.errorCode in TRANSPORT_ERRORS) {
            Log.w(EmberPlaybackService.TAG, "connection gave out on $failed, staying on it: ${error.errorCodeName}")
            return
        }
        errorsInARow++
        val title = item?.let(::titleOf).orEmpty()
        fun report(outcome: String) {
            val notice = Unplayable.notice(failed.orEmpty(), title, error, outcome)
            Log.w(EmberPlaybackService.TAG, "$outcome $failed (${notice.kind}${notice.reason?.let { ", $it" } ?: ""}): ${error.errorCodeName}")
            if (failed != null) onUnplayable(notice)
        }
        if (errorsInARow >= MAX_ERRORS_IN_A_ROW) {
            // The next try (play pressed, a song picked) gets every try again.
            errorsInARow = 0
            report(Unplayable.GAVE_UP)
            return
        }
        if (!player.hasNextMediaItem()) {
            // A song YouTube no longer has, at the end of the queue: radio may
            // find what comes next. The count of failures in a row carries on
            // through radio's songs, so a run of dead ones still stops.
            val gone = Unplayable.kindOf(Unplayable.httpFailure(error)?.first) == Unplayable.UNAVAILABLE
            val waiting = gone && extendAfterFailure { added ->
                // The player is past this song already: an earlier ask for it
                // (it failed again while radio looked) moved on, or a song was
                // picked. Nothing stopped, so nothing to report.
                if (player.currentMediaItem?.mediaId != failed) return@extendAfterFailure
                if (added && player.hasNextMediaItem()) {
                    report(Unplayable.SKIPPED)
                    player.seekToNextMediaItem()
                    player.prepare()
                } else {
                    errorsInARow = 0
                    report(Unplayable.STOPPED)
                }
            }
            if (!waiting) {
                errorsInARow = 0
                report(Unplayable.STOPPED)
            }
            return
        }
        report(Unplayable.SKIPPED)
        player.seekToNextMediaItem()
        player.prepare()
    }

    private fun titleOf(item: MediaItem): String =
        item.mediaMetadata.title?.toString() ?: TrackItems.trackOf(item)?.optString("title").orEmpty()
}
