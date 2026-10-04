package app.ember.music

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import java.util.concurrent.Executor

/** The CastPlayer as the session (the app, the notification, the lock
 *  screen) sees it while casting.
 *
 *  Every song handed to it goes to the TV on a signed link (CastSigner):
 *  the TV has no Ember cookie. Signing is a network call, so a change to
 *  the queue waits for its links and is then applied, in the order the
 *  changes came in. A song the server will not sign (or a server that
 *  cannot be reached) goes over as it is, fails on the TV, and the queue
 *  moves on past it.
 *
 *  A Cast queue is sent in one message, and a message has a size limit, so
 *  a very long queue goes over as the [MAX_ITEMS] songs from the playing
 *  one on. */
class CastQueuePlayer(
    cast: Player,
    private val signer: CastSigner,
    private val baseUrl: String,
    private val io: Executor,
    private val main: Executor,
    /** What Previous goes back to while casting (PlayHistory), as on the
     *  phone. Null: Media3's own, the song above. */
    private val history: PlayHistory? = null,
) : ForwardingPlayer(cast) {
    companion object {
        const val MAX_ITEMS = 300
        const val TAG = "EmberCast"

        /** The part of [items] that goes to the TV, and where [index] lands
         *  in it: all of it when it fits, else [max] songs from [index] on. */
        fun window(items: List<MediaItem>, index: Int, max: Int = MAX_ITEMS): Pair<List<MediaItem>, Int> {
            if (items.size <= max) return items to index
            val from = index.coerceIn(0, items.size - 1)
            return items.subList(from, minOf(items.size, from + max)) to 0
        }
    }

    private class Op(val items: List<MediaItem>, val apply: (List<MediaItem>) -> Unit)

    private val ops = ArrayDeque<Op>()
    private var signing = false
    /** Ids already asked for in this batch: asked once, then sent as they are. */
    private val asked = HashSet<String>()
    /** What play/pause last asked for: a queue that lands later (after its
     *  links) must not start playing when the listener paused meanwhile. */
    private var wantPlay = false

    private fun enqueue(items: List<MediaItem>, apply: (List<MediaItem>) -> Unit) {
        ops.addLast(Op(items, apply))
        drain()
    }

    /** Applies the waiting changes in order, each once its links are here.
     *  Main thread, like the player. */
    private fun drain() {
        // Links on their way: everything waits for them, in order.
        if (signing) return
        while (ops.isNotEmpty()) {
            val op = ops.first()
            val missing = signer.missing(op.items.map { it.mediaId }).filter { it !in asked }
            if (missing.isNotEmpty()) {
                signing = true
                asked.addAll(missing)
                io.execute {
                    runCatching { signer.sign(missing) }
                        .onFailure { Log.w(TAG, "signing ${missing.size} cast link(s) failed: ${it.message}") }
                    main.execute {
                        signing = false
                        drain()
                    }
                }
                return
            }
            ops.removeFirst()
            op.apply(op.items.map { CastItems.forCast(it, signer.fresh(it.mediaId), baseUrl) })
        }
        asked.clear()
    }

    /** True while queue changes wait for their links. */
    val pending: Boolean get() = ops.isNotEmpty()

    private fun load(items: List<MediaItem>, index: Int, positionMs: Long) {
        val (part, at) = window(items, index)
        if (part.size < items.size) Log.w(TAG, "queue of ${items.size} is too long to cast whole; sending ${part.size} from the playing song")
        enqueue(part) { signed ->
            super.setMediaItems(signed, at, positionMs)
            super.prepare()
            // Cast starts a loaded queue by itself.
            if (!wantPlay) super.setPlayWhenReady(false)
        }
    }

    override fun setMediaItems(mediaItems: List<MediaItem>) = load(mediaItems, 0, C.TIME_UNSET)
    override fun setMediaItems(mediaItems: List<MediaItem>, resetPosition: Boolean) =
        if (resetPosition) load(mediaItems, 0, C.TIME_UNSET) else load(mediaItems, currentMediaItemIndex, currentPosition)
    override fun setMediaItems(mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long) =
        load(mediaItems, if (startIndex == C.INDEX_UNSET) currentMediaItemIndex else startIndex, startPositionMs)
    override fun setMediaItem(mediaItem: MediaItem) = load(listOf(mediaItem), 0, C.TIME_UNSET)
    override fun setMediaItem(mediaItem: MediaItem, startPositionMs: Long) = load(listOf(mediaItem), 0, startPositionMs)
    override fun setMediaItem(mediaItem: MediaItem, resetPosition: Boolean) = load(listOf(mediaItem), 0, C.TIME_UNSET)

    override fun addMediaItem(mediaItem: MediaItem) = enqueue(listOf(mediaItem)) { super.addMediaItems(it) }
    override fun addMediaItem(index: Int, mediaItem: MediaItem) = enqueue(listOf(mediaItem)) { super.addMediaItems(index, it) }
    override fun addMediaItems(mediaItems: List<MediaItem>) = enqueue(mediaItems.toList()) { super.addMediaItems(it) }
    override fun addMediaItems(index: Int, mediaItems: List<MediaItem>) = enqueue(mediaItems.toList()) { super.addMediaItems(index, it) }
    override fun replaceMediaItem(index: Int, mediaItem: MediaItem) =
        enqueue(listOf(mediaItem)) { super.replaceMediaItems(index, index + 1, it) }
    override fun replaceMediaItems(fromIndex: Int, toIndex: Int, mediaItems: List<MediaItem>) =
        enqueue(mediaItems.toList()) { super.replaceMediaItems(fromIndex, toIndex, it) }

    // Moves by index wait behind queue changes still being signed. The app's
    // MediaController already shows the queue it asked for (Media3 masks its
    // own changes), so an index it sends means a place in THAT queue: applied
    // before the queue lands, it would hit the wrong song.
    private fun ordered(fn: () -> Unit) = if (ops.isEmpty() && !signing) fn() else enqueue(emptyList()) { fn() }

    /** Runs [fn] once everything asked of this player so far is applied. */
    fun afterPending(fn: () -> Unit) = ordered(fn)

    override fun seekTo(mediaItemIndex: Int, positionMs: Long) = ordered { super.seekTo(mediaItemIndex, positionMs) }
    override fun seekTo(positionMs: Long) = ordered { super.seekTo(positionMs) }
    override fun seekToDefaultPosition(mediaItemIndex: Int) = ordered { super.seekToDefaultPosition(mediaItemIndex) }
    override fun seekToNext() = ordered { super.seekToNext() }
    override fun seekToPrevious() = ordered {
        val h = history
        if (h != null) h.seekToPrevious(wrappedPlayer) else super.seekToPrevious()
    }
    override fun seekToNextMediaItem() = ordered { super.seekToNextMediaItem() }
    override fun seekToPreviousMediaItem() = ordered {
        val h = history
        if (h != null) h.seekToPreviousMediaItem(wrappedPlayer) else super.seekToPreviousMediaItem()
    }
    override fun removeMediaItem(index: Int) = ordered { super.removeMediaItem(index) }
    override fun removeMediaItems(fromIndex: Int, toIndex: Int) = ordered { super.removeMediaItems(fromIndex, toIndex) }
    override fun moveMediaItem(currentIndex: Int, newIndex: Int) = ordered { super.moveMediaItem(currentIndex, newIndex) }
    override fun moveMediaItems(fromIndex: Int, toIndex: Int, newIndex: Int) = ordered { super.moveMediaItems(fromIndex, toIndex, newIndex) }

    override fun setPlayWhenReady(playWhenReady: Boolean) {
        wantPlay = playWhenReady
        super.setPlayWhenReady(playWhenReady)
    }
    override fun play() {
        wantPlay = true
        super.play()
    }
    override fun pause() {
        wantPlay = false
        super.pause()
    }
}
