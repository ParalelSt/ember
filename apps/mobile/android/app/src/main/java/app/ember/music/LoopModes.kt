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
}
