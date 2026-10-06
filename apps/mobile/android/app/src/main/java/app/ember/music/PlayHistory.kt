package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
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
        /** A song that failed this far in had played: it is not dead. */
        const val HEARD_AFTER_MS = 1_000L
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
    /** Songs in this queue that failed before a note of them played (the
     *  player skipped them). Previous does not go back to one: it would fail
     *  again and be skipped forward to the song Previous was pressed on, so
     *  Previous could never get past it. Forgotten once the song plays. */
    private val dead = HashSet<String>()

    /** Songs the offline rules moved past because they are not on the
     *  phone (OfflinePlayback). Going back to one bounced forward again, like
     *  a [dead] song. Forgotten when the connection is back. */
    private val passed = HashSet<String>()

    /** Offline, the player was moved past [id] (OfflinePlayback). */
    fun passedOver(id: String) {
        passed.add(id)
        changed()
    }

    /** The connection is back: songs passed over offline can play again. */
    fun backOnline() {
        passed.clear()
        changed()
    }

    /** The stack, oldest first (for tests and logs). */
    val ids: List<String> get() = stack.toList()

    /** The stack as the app's queue sheet shows it ("Played"), oldest first,
     *  newest last: without the songs Previous would pass over ([dead],
     *  [passed]). The sheet walks it the way [previous] does. */
    val visible: List<String> get() = stack.filter { !skipped(it) }

    /** Called (on the player's thread) whenever [visible] changes: the
     *  service publishes it to the app (EmberPlaybackService.EXTRA_PLAYED). */
    var onChange: (() -> Unit)? = null
    private var lastVisible: List<String> = emptyList()
    private fun changed() {
        val now = visible
        if (now == lastVisible) return
        lastVisible = now
        onChange?.invoke()
    }

    /** The song being left, pushed on top. */
    fun played(id: String) {
        stack.addLast(id)
        while (stack.size > max) stack.removeFirst()
        changed()
    }

    fun clear() {
        stack.clear()
        dead.clear()
        passed.clear()
        changed()
    }

    /** Where Previous goes for a player at [index] of [queue] (media ids),
     *  [positionMs] into the song. Pops the entries it uses or finds stale (a
     *  song no longer in the queue); a restart pops nothing. When a song is
     *  in the queue twice, the copy nearest the current one. */
    fun previous(queue: List<String>, index: Int, positionMs: Long): Move {
        if (positionMs > RESTART_AFTER_MS) return Move.Restart
        val move = pop(queue, index)
        changed()
        return move
    }

    /** [previous] without the restart rule or the change report. */
    private fun pop(queue: List<String>, index: Int): Move {
        while (stack.isNotEmpty()) {
            val id = stack.removeLast()
            var best = -1
            queue.forEachIndexed { i, q ->
                if (i != index && q == id && !skipped(id) && (best < 0 || Math.abs(i - index) < Math.abs(best - index))) best = i
            }
            if (best >= 0) return Move.To(best)
        }
        return Move.Default
    }

    /** A tap on a song in the app's "Played" list: back through the history
     *  to the queue entry [target], as Previous pressed until it lands there
     *  (without the restart rule). Pops what it walks through and returns
     *  true; false, with the history untouched, when it does not lead there
     *  (the list the app showed is out of date). The web player's playBack. */
    fun back(queue: List<String>, index: Int, target: Int): Boolean {
        val before = ArrayList(stack)
        var at = index
        while (true) {
            val move = pop(queue, at)
            if (move !is Move.To) {
                stack.clear()
                stack.addAll(before)
                return false
            }
            if (move.index == target) {
                changed()
                return true
            }
            at = move.index
        }
    }

    /** Carries out [back] on [player] (the player underneath the session's
     *  wrapper). Nothing when the history does not lead to [target]. */
    fun seekBack(player: Player, target: Int) {
        if (target < 0 || target >= player.mediaItemCount) return
        val queue = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        if (!back(queue, player.currentMediaItemIndex, target)) return
        goingBackTo = queue[target]
        player.seekToDefaultPosition(target)
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
                val before = previousUsable(player, queue)
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
                val before = previousUsable(player, queue)
                if (before != C.INDEX_UNSET) {
                    goingBackTo = queue.getOrNull(before)
                    player.seekToDefaultPosition(before)
                }
            }
        }
    }

    /** The song before the current one in the queue (Media3's previous item,
     *  which wraps under repeat-all), passing over songs that are [dead] or
     *  were [passed] over offline. */
    private fun skipped(id: String?) = id in dead || id in passed

    private fun previousUsable(player: Player, queue: List<String>): Int {
        val current = player.currentMediaItemIndex
        fun skip(i: Int) = skipped(queue.getOrNull(i))
        var i = player.previousMediaItemIndex
        if (i == C.INDEX_UNSET || !skip(i)) return i
        val timeline = player.currentTimeline
        val repeat = if (player.repeatMode == Player.REPEAT_MODE_ONE) Player.REPEAT_MODE_OFF else player.repeatMode
        var steps = 0
        while (i != C.INDEX_UNSET && i != current && skip(i) && steps++ < queue.size) {
            i = timeline.getPreviousWindowIndex(i, repeat, player.shuffleModeEnabled)
        }
        return if (i == current || (i != C.INDEX_UNSET && skip(i))) C.INDEX_UNSET else i
    }

    /** Feeds the stack from the player it listens to. */
    inner class Tracker(private val player: Player) : Player.Listener {
        private var playing: String? = player.currentMediaItem?.mediaId
        /** The song playing now has started playing since it came up. */
        private var heard = player.isPlaying

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!isPlaying) return
            heard = true
            playing?.let(dead::remove)
            changed()
        }

        /** A song that fails before it has played is one the player skips:
         *  not something Previous should go back to. One that played a while
         *  and then dropped (a natural advance into it raises no
         *  onIsPlayingChanged, hence the position) is still history. */
        override fun onPlayerError(error: PlaybackException) {
            val id = playing ?: return
            if (!heard && player.currentPosition < HEARD_AFTER_MS) dead.add(id)
            changed()
        }

        override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
            val left = playing
            val now = item?.mediaId
            playing = now
            heard = false
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
                // The next song, a natural advance, a tap in the queue. Not
                // a song the player skipped (see `dead` and `passed`).
                left != null && left != now && !skipped(left) -> played(left)
            }
        }
    }
}

/** A session player that can go back through the play history to a given
 *  queue entry (the app's "Played" list): LevelPlayer, the cast queue. */
interface HistoryBack {
    fun seekBackTo(index: Int)
}
