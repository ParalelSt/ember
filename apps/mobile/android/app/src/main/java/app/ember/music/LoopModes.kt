package app.ember.music

import androidx.media3.common.Player

/** The web app's loop button ("off" / "all" / "one") in Media3's terms, and
 *  back again for a change made from the car or the notification. */
object LoopModes {
    fun toRepeat(mode: String?): Int? = when (mode) {
        "off" -> Player.REPEAT_MODE_OFF
        "all" -> Player.REPEAT_MODE_ALL
        "one" -> Player.REPEAT_MODE_ONE
        else -> null
    }

    fun fromRepeat(repeat: Int): String = when (repeat) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
    }

    /** The player's repeat mode as the auto cache's window sees it: loop-all
     *  wraps the window to the top of the queue, loop-one keeps it on the
     *  song. What the loop button sends (setRepeat) lands here. */
    fun forCache(repeat: Int): AutoCachePolicy.LoopMode = when (repeat) {
        Player.REPEAT_MODE_ALL -> AutoCachePolicy.LoopMode.ALL
        Player.REPEAT_MODE_ONE -> AutoCachePolicy.LoopMode.ONE
        else -> AutoCachePolicy.LoopMode.OFF
    }
}
