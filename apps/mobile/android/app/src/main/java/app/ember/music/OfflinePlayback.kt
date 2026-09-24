package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline

/** What the native player does when the connection is gone.
 *
 *  A song that is on the phone (a pinned download, or whole in the auto
 *  cache) plays. One that is not is skipped, forward in play order and
 *  respecting loop-all, instead of erroring the queue to a stop. When nothing
 *  ahead is on the phone, playback pauses and `stalled` is set, so the UI can
 *  say "Offline, nothing cached ahead". When the network is back the stalled
 *  song is loaded again, paused: the listener presses play.
 *
 *  Nothing here marks a song unavailable or talks to the server. */
class OfflinePlayback(
    private val player: Player,
    /** The whole song can play without the network. */
    private val playableOffline: (MediaItem) -> Boolean,
    /** Asked live, not cached: the validated-network callback can lag the
     *  player's own network error by a moment. */
    private val isOnline: () -> Boolean,
    private val onStalledChanged: (Boolean) -> Unit = {},
) : Player.Listener {
    var stalled = false
        private set

    /** This error is the connection being gone, which these rules own: the
     *  queue listener's skip-on-error (QueueListener) stands aside for it. */
    fun handles(error: PlaybackException): Boolean = error.errorCode in NETWORK_ERRORS && !isOnline()

    /** Offline, this song cannot load, so the player is moved past it at
     *  once: it is never heard, and never counts as a play. */
    fun skips(item: MediaItem): Boolean = !isOnline() && !playableOffline(item)

    override fun onPlayerError(error: PlaybackException) {
        if (handles(error)) skipAhead()
    }

    /** Pre-empt: an auto-advance (or a tap, or the car's Next) onto a song
     *  that cannot load offline moves on before it errors. */
    override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
        if (item == null) return
        if (skips(item)) skipAhead()
        // A song that can play (picked by hand, say) ends a stall.
        else setStalled(false)
    }

    /** From the validated-network callback. */
    fun onNetwork(online: Boolean) {
        if (online) {
            setStalled(false)
            // Load the stalled (or errored) song again, paused: no surprise audio.
            if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
            return
        }
        // The player gave up before the phone noticed the network was gone.
        val e = player.playerError
        if (e != null && e.errorCode in NETWORK_ERRORS) skipAhead()
    }

    private fun skipAhead() {
        val target = nextOfflineIndex(player.currentTimeline, player.currentMediaItemIndex, player.repeatMode, player.shuffleModeEnabled) {
            playableOffline(player.getMediaItemAt(it))
        }
        if (target == C.INDEX_UNSET) {
            player.pause()
            setStalled(true)
            return
        }
        setStalled(false)
        // playWhenReady is left as it was: a playing queue keeps playing.
        player.seekTo(target, 0)
        player.prepare()
    }

    private fun setStalled(v: Boolean) {
        if (stalled == v) return
        stalled = v
        onStalledChanged(v)
    }

    companion object {
        /** Load failures that mean "could not reach the server". */
        val NETWORK_ERRORS = setOf(
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
        )

        /** The next window after `from`, in play order, that `playable`
         *  accepts; C.INDEX_UNSET when none. Loop-all wraps (one lap at most);
         *  loop-one looks ahead like off, since replaying a song that just
         *  failed would fail again. */
        fun nextOfflineIndex(timeline: Timeline, from: Int, repeatMode: Int, shuffle: Boolean, playable: (Int) -> Boolean): Int {
            if (timeline.isEmpty || from == C.INDEX_UNSET) return C.INDEX_UNSET
            val mode = if (repeatMode == Player.REPEAT_MODE_ALL) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
            var i = from
            repeat(timeline.windowCount) {
                i = timeline.getNextWindowIndex(i, mode, shuffle)
                if (i == C.INDEX_UNSET || i == from) return C.INDEX_UNSET
                if (playable(i)) return i
            }
            return C.INDEX_UNSET
        }
    }
}
