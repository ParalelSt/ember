package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline

/** What the native player does when the connection is gone, or gets
 *  nothing through.
 *
 *  A song that is on the phone (a pinned download, or whole in the auto
 *  cache) plays. One that is not is skipped, forward in play order and
 *  respecting loop-all, instead of erroring the queue to a stop. The song
 *  playing when the connection goes plays on from what is loaded
 *  (SongLoadControl loads it whole); only when it runs dry does the player
 *  move on.
 *
 *  When nothing ahead is on the phone, the player waits on the song, play
 *  still on, and `stalled` is set, so the UI can say "Offline, nothing
 *  cached ahead". When the connection is back the song goes on by itself:
 *  the player was never paused. (It used to pause, and stayed silent until
 *  someone pressed play.)
 *
 *  "Gone" is [isOnline] false: no validated network, or one that carries
 *  nothing (ConnectionHealth). A song stuck loading for [STUCK_MS] asks
 *  which it is ([onStuck]); the answer comes back through [onNetwork].
 *
 *  Nothing here marks a song unavailable or talks to the server. */
class OfflinePlayback(
    private val player: Player,
    /** The whole song can play without the network. */
    private val playableOffline: (MediaItem) -> Boolean,
    /** Asked live, not cached: the validated-network callback can lag the
     *  player's own network error by a moment. */
    private val isOnline: () -> Boolean,
    /** The player is being moved past this song (its media id) because it
     *  cannot play offline (PlayHistory: Previous does not go back to it). */
    private val onPassedOver: (String) -> Unit = {},
    /** Runs the task after the delay on the main thread, and returns its
     *  cancel. Null: no watch on a stuck song (tests that do not need it). */
    private val later: ((Long, Runnable) -> () -> Unit)? = null,
    /** A song has been stuck loading for [STUCK_MS] while online: is the
     *  connection getting anything through? (ConnectionHealth.suspect) */
    private val onStuck: () -> Unit = {},
    private val onStalledChanged: (Boolean) -> Unit = {},
) : Player.Listener {
    var stalled = false
        private set

    private var cancelWatch: (() -> Unit)? = null
    /** The last answer [onNetwork] had, to tell the connection coming back
     *  from one more "still online". */
    private var wasOnline: Boolean? = null

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
        watch()
    }

    override fun onPlaybackStateChanged(playbackState: Int) = watch()

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = watch()

    /** The connection changed: [online] is the validated network that also
     *  carries data. */
    fun onNetwork(online: Boolean) {
        val back = online && wasOnline == false
        wasOnline = online
        if (online) {
            setStalled(false)
            if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) {
                // Load the stalled (or errored) song again. Play was left on,
                // so it goes on by itself.
                player.prepare()
            } else if (back && stuck()) {
                // Try now, on a fresh connection, not when the player's next
                // wait (up to 30 s) ends or a dead socket times out. Stopping
                // keeps the song, its place and play on; what was loaded is
                // in the cache.
                player.stop()
                player.prepare()
            }
            watch()
            return
        }
        // The player gave up before the phone noticed the network was gone,
        // or a song is waiting on a connection that is not there.
        val e = player.playerError
        if ((e != null && e.errorCode in NETWORK_ERRORS) || stuck()) skipAhead()
    }

    /** Playing (or meaning to), and waiting on the network for a song that
     *  is not on the phone. */
    private fun stuck(): Boolean {
        if (!player.playWhenReady || player.playbackState != Player.STATE_BUFFERING) return false
        val item = player.currentMediaItem ?: return false
        return !playableOffline(item)
    }

    /** Watches a stuck song: offline it moves on at once; online, after
     *  [STUCK_MS] it asks whether the connection is there, and again every
     *  [STUCK_MS] while the song stays stuck. */
    private fun watch() {
        cancelWatch?.invoke()
        cancelWatch = null
        if (!stuck()) return
        if (!isOnline()) {
            skipAhead()
            return
        }
        val schedule = later ?: return
        cancelWatch = schedule(STUCK_MS, Runnable {
            cancelWatch = null
            if (!stuck()) return@Runnable
            onStuck()
            watch()
        })
    }

    private fun skipAhead() {
        val target = nextOfflineIndex(player.currentTimeline, player.currentMediaItemIndex, player.repeatMode, player.shuffleModeEnabled) {
            playableOffline(player.getMediaItemAt(it))
        }
        if (target == C.INDEX_UNSET) {
            // Nothing to move to: wait on this song, play left on, so it goes
            // on by itself when the connection is back.
            setStalled(true)
            return
        }
        setStalled(false)
        player.currentMediaItem?.mediaId?.let(onPassedOver)
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
        /** A song waiting this long on the network makes the player ask
         *  whether the connection is there at all. Long enough for the host
         *  to fetch a song it does not have yet. */
        const val STUCK_MS = 8_000L

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
