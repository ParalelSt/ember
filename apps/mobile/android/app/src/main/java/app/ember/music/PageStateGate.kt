package app.ember.music

/** Which `state` events reach the page (EmberPlayerPlugin), by whether the
 *  app is on screen.
 *
 *  On screen: all of them, the ~4 Hz position tick included.
 *
 *  Off screen (the activity stopped: the screen off, another app in front):
 *  Chromium freezes a hidden page that plays no sound of its own after about
 *  five minutes (Ember's music plays natively, so the page is silent). A
 *  frozen page runs nothing, and every event sent to it waits in line. At
 *  4 Hz that was thousands of stale positions, all replayed when the screen
 *  came back on: the bar raced through songs long finished, the page was too
 *  busy to draw (a black screen) and taps that navigate never got their turn
 *  (bug report 2026-10-09). So off screen only a real change is sent (another
 *  song, play or pause, the loop or shuffle mode, offline): what the page
 *  still acts on in the background, a few events per song at most. The
 *  position is not sent at all; coming back on screen sends one fresh state
 *  ([onScreen] returns true) and the tick starts again.
 *
 *  Main thread only, like every caller in the plugin. */
class PageStateGate {
    var onScreen = true
        private set
    /** The last state sent, without its position (see [key]). */
    private var lastKey: String? = null

    /** Whether a state with this [key] goes to the page. [tick]: the
     *  periodic position report, as opposed to a player or session event. */
    fun admit(key: String, tick: Boolean): Boolean {
        if (onScreen) {
            lastKey = key
            return true
        }
        if (tick || key == lastKey) return false
        lastKey = key
        return true
    }

    /** The app came back on screen: the caller sends one fresh state now
     *  (true when it was off screen before). */
    fun shown(): Boolean {
        val was = onScreen
        onScreen = true
        return !was
    }

    fun hidden() {
        onScreen = false
    }

    companion object {
        /** What tells two states apart for a page that is not on screen:
         *  everything but the position, the length and the cache list. */
        fun key(index: Int, trackId: String?, playing: Boolean, loop: String, shuffle: Boolean, offlineStalled: Boolean, offline: Boolean): String =
            listOf(index, trackId ?: "", playing, loop, shuffle, offlineStalled, offline).joinToString("\u0000")
    }
}
