package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player

/** What Previous goes back to: the songs actually played, not the song above
 *  in the queue. The web player's rule (apps/web/lib/playback/queueNav.ts,
 *  "Play history"), kept here because on Android the queue lives in this
 *  service and Previous comes from everywhere: the app, the notification, the
 *  lock screen, a Bluetooth head unit and the car all end up in the session
 *  player's seekToPrevious (LevelPlayer, CastQueuePlayer).
 *
 *  The rule: every time a song starts because the player moved on to it (the
 *  next song, a natural advance, a tap on a song in the queue), the song
 *  being left is pushed onto a small stack of media ids. Previous, within the
 *  first [RESTART_AFTER_MS] of a song, pops that stack and goes back to the
 *  song on top, wherever it is in the queue; past that it starts the song over
 *  (unchanged). Going back never pushes, so pressing Previous again keeps
 *  walking back through what was really played. With nothing usable on the
 *  stack it goes to the song before in the queue, as Media3 does. A whole new
 *  queue starts a fresh stack.
 *
 *  Reported on 0.7.15: play A, tap D further down an auto-generated (radio)
 *  queue, and Previous went to C instead of back to A.
 *
 *  The decision ([previous]) is pure; [Tracker] feeds it from the player's
 *  transitions and [seekToPrevious] carries it out. */
class PlayHistory(private val max: Int = MAX) {
    companion object {
        /** How many songs the stack keeps (oldest dropped first). */
        const val MAX = 100
        /** Past this far into a song, Previous starts it over: Media3's own
         *  default (maxSeekToPreviousPosition) and the web player's 3 s. */
        const val RESTART_AFTER_MS = 3_000L
    }

    sealed interface Move {
        /** Start the current song over. */
        data object Restart : Move
        /** Go to the song at [index] in the queue. */
        data class To(val index: Int) : Move
        /** Nothing in the history: the song before in the queue (Media3's
         *  previous item, which wraps under repeat-all), or a restart when
         *  there is none. */
        data object Default : Move
    }

    private val stack = ArrayDeque<String>()

    /** The stack, oldest first (for tests and logs). */
    val ids: List<String> get() = stack.toList()

    /** The song being left, pushed on top. */
    fun played(id: String) {
        stack.addLast(id)
        while (stack.size > max) stack.removeFirst()
    }

    fun clear() = stack.clear()

    /** Where Previous goes for a player at [index] of [queue] (media ids),
     *  [positionMs] into the song. Pops the entries it uses or finds stale (a
     *  song no longer in the queue); a restart pops nothing. When a song is
     *  in the queue twice, the copy nearest the current one. */
    fun previous(queue: List<String>, index: Int, positionMs: Long): Move {
        if (positionMs > RESTART_AFTER_MS) return Move.Restart
        while (stack.isNotEmpty()) {
            val id = stack.removeLast()
            var best = -1
            queue.forEachIndexed { i, q ->
                if (i != index && q == id && (best < 0 || Math.abs(i - index) < Math.abs(best - index))) best = i
            }
            if (best >= 0) return Move.To(best)
        }
        return Move.Default
    }

    /** The id the next transition is expected to land on because Previous
     *  sent the player there: that one is not a move on, so nothing is
     *  pushed for it. */
    private var goingBackTo: String? = null

    /** Carries out Previous on [player] (the player underneath the session's
     *  wrapper, so this does not loop back into the override). */
    fun seekToPrevious(player: Player) {
        if (player.mediaItemCount == 0) return
        val queue = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        val index = player.currentMediaItemIndex
        when (val move = previous(queue, index, player.currentPosition)) {
            Move.Restart -> player.seekTo(0)
            is Move.To -> {
                goingBackTo = queue[move.index]
                player.seekToDefaultPosition(move.index)
            }
            Move.Default -> {
                val before = player.previousMediaItemIndex
                if (before == C.INDEX_UNSET) {
                    player.seekTo(0)
                } else {
                    goingBackTo = queue.getOrNull(before)
                    player.seekToDefaultPosition(before)
                }
            }
        }
    }

    /** "Previous item" asked for directly (some controllers send it instead of
     *  Previous): the same history, without the restart rule. */
    fun seekToPreviousMediaItem(player: Player) {
        if (player.mediaItemCount == 0) return
        val queue = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        when (val move = previous(queue, player.currentMediaItemIndex, 0)) {
            is Move.To -> {
                goingBackTo = queue[move.index]
                player.seekToDefaultPosition(move.index)
            }
            else -> {
                val before = player.previousMediaItemIndex
                if (before != C.INDEX_UNSET) {
                    goingBackTo = queue.getOrNull(before)
                    player.seekToDefaultPosition(before)
                }
            }
        }
    }

    /** Feeds the stack from the player it listens to. */
    inner class Tracker(player: Player) : Player.Listener {
        private var playing: String? = player.currentMediaItem?.mediaId

        override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
            val left = playing
            val now = item?.mediaId
            playing = now
            val back = goingBackTo
            goingBackTo = null
            when {
                // Previous sent it here: going back is not playing on.
                back != null && back == now -> {}
                // A new queue (setMediaItems: another list, the saved queue,
                // the queue coming back from a TV): a fresh history.
                reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED -> clear()
                // Repeat-one playing the same song again.
                reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> {}
                // The next song, a natural advance, a tap in the queue.
                left != null && left != now -> played(left)
            }
        }
    }
}
