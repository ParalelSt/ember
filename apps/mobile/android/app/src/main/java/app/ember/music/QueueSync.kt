package app.ember.music

import androidx.media3.common.MediaItem
import androidx.media3.common.Player

/** Turns the queue native has into the one the web app sent. The app sends
 *  the whole queue on every change (shuffle, a song removed, radio, a tap in
 *  a new list), so this decides what actually has to change: the song that
 *  is playing keeps playing, from where it is, whenever it is still the one
 *  the app asks for. Only a different song starts from the top. */
object QueueSync {
    sealed interface Plan {
        /** Same queue, same song: nothing to do. */
        data object Keep : Plan
        /** Same queue, another song: jump to it. */
        data class Seek(val index: Int) : Plan
        /** The playing song stays; only what is around it changes. [before] and
         *  [after] swap the songs on that side; [appendFrom] adds the new
         *  songs from there on to the end (radio, add to queue). */
        data class Around(val before: Boolean, val after: Boolean, val appendFrom: Int?) : Plan
        /** Another song plays now: load the new queue at [index]. */
        data class Load(val index: Int) : Plan
    }

    fun plan(current: List<String>, currentIndex: Int, wanted: List<String>, index: Int): Plan {
        if (wanted == current) return if (index != currentIndex) Plan.Seek(index) else Plan.Keep
        val playing = current.getOrNull(currentIndex)
        if (playing == null || wanted.getOrNull(index) != playing) return Plan.Load(index)
        val before = current.subList(0, currentIndex) != wanted.subList(0, index)
        val oldTail = current.subList(currentIndex + 1, current.size)
        val newTail = wanted.subList(index + 1, wanted.size)
        return when {
            newTail == oldTail -> Plan.Around(before, after = false, appendFrom = null)
            newTail.size > oldTail.size && newTail.subList(0, oldTail.size) == oldTail ->
                Plan.Around(before, after = false, appendFrom = index + 1 + oldTail.size)
            else -> Plan.Around(before, after = true, appendFrom = null)
        }
    }

    /** Applies the plan to [player]: the MediaController in the app, the
     *  ExoPlayer itself in tests. */
    fun apply(player: Player, items: List<MediaItem>, index: Int) {
        val current = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        val at = player.currentMediaItemIndex
        when (val p = plan(current, at, items.map { it.mediaId }, index)) {
            Plan.Keep -> {}
            is Plan.Seek -> player.seekTo(p.index, 0)
            is Plan.Around -> {
                // Never touching the playing item itself is what keeps it going.
                // The side after it first, so the indices before it still hold.
                if (p.after) player.replaceMediaItems(at + 1, player.mediaItemCount, items.subList(index + 1, items.size))
                p.appendFrom?.let { player.addMediaItems(items.subList(it, items.size)) }
                if (p.before) player.replaceMediaItems(0, at, items.subList(0, index))
            }
            is Plan.Load -> { player.setMediaItems(items, p.index, 0); player.prepare() }
        }
    }
}
