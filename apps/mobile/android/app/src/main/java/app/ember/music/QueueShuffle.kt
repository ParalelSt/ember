package app.ember.music

import kotlin.random.Random

/** Shuffle as the web app does it (stores/usePlayerStore toggleShuffle): the
 *  queue itself is reordered, the songs still to come only, and the order
 *  before is kept so turning shuffle off puts it back.
 *
 *  The car's Shuffle button (and a head unit's, over Bluetooth) used to flip
 *  Media3's shuffle mode, a play order of its own that the app never saw:
 *  its queue and its shuffle button stayed as they were while the car played
 *  in another order. Reordering the queue instead shows up in the app as a
 *  queue change, like any other (EmberPlayerPlugin's `queue` event), with
 *  the shuffle flag beside it. */
object QueueShuffle {
    /** The new order, as indexes into the queue: everything up to and
     *  including [index] stays, the rest in random order. */
    fun shuffledOrder(size: Int, index: Int, random: Random = Random.Default): List<Int> {
        if (size <= 0) return emptyList()
        val at = index.coerceIn(-1, size - 1)
        return (0..at).toList() + ((at + 1) until size).shuffled(random)
    }

    /** The queue put back in its pre-shuffle order, as it is NOW (the web
     *  app's restoreOrder): [original] only decides the order. A song removed
     *  since stays removed, one added since (radio) goes after the original
     *  ones in the order it was added, and a song listed twice is matched
     *  copy by copy. Answers the new order (indexes into [queue]) and where
     *  the playing entry [index] lands. */
    fun restoredOrder(original: List<String>, queue: List<String>, index: Int): Pair<List<Int>, Int> {
        val positions = HashMap<String, ArrayDeque<Int>>()
        queue.forEachIndexed { i, id -> positions.getOrPut(id) { ArrayDeque() }.addLast(i) }
        val order = ArrayList<Int>(queue.size)
        for (id in original) positions[id]?.removeFirstOrNull()?.let { order.add(it) }
        val placed = order.toHashSet()
        queue.indices.forEach { if (it !in placed) order.add(it) }
        val at = order.indexOf(index)
        return order to (if (at >= 0) at else index)
    }
}

/** Whether the queue is shuffled, and its order from before (the song ids),
 *  kept by the player service. */
class ShuffleState {
    var on = false
        private set
    var original: List<String>? = null
        private set

    fun shuffled(before: List<String>) {
        // Shuffling again keeps the first order: off still goes back to it.
        if (!on || original == null) original = before
        on = true
    }

    /** Shuffle set by the app, which reorders its own queue: its order from
     *  before comes with it (null when it did not send one). */
    fun setByApp(on: Boolean, before: List<String>?) {
        this.on = on
        original = if (on) before ?: original else null
    }

    fun clear() { on = false; original = null }
}
