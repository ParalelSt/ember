package app.ember.music

import android.os.Bundle
import androidx.media3.common.Player
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand

/** The buttons beside play/pause and skip on the car's now-playing screen,
 *  the notification and the lock screen: like and shuffle (the owner's pick;
 *  repeat stays on the app's loop button and the car's own repeat command).
 *  Each one shows its state (a filled heart, shuffle on) and says it in its
 *  name, which the car reads out and shows as a label. */
object CarButtons {
    const val COMMAND_LIKE = "ember.like"

    fun layout(liked: Boolean?, shuffle: Boolean): List<CommandButton> = listOfNotNull(
        liked?.let { like(it) },
        shuffle(shuffle),
    )

    fun like(liked: Boolean): CommandButton =
        CommandButton.Builder(if (liked) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
            .setDisplayName(if (liked) "Remove from Liked songs" else "Add to Liked songs")
            .setSessionCommand(SessionCommand(COMMAND_LIKE, Bundle.EMPTY))
            .build()

    fun shuffle(on: Boolean): CommandButton =
        CommandButton.Builder(if (on) CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF)
            .setDisplayName(if (on) "Shuffle on" else "Shuffle off")
            .setSessionCommand(SessionCommand(EmberPlaybackService.COMMAND_SHUFFLE, Bundle.EMPTY))
            .build()

    /** The car's repeat command's next mode: off, all, one, off. */
    fun nextRepeat(mode: Int): Int = when (mode) {
        Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
        Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }
}

/** Which songs are liked, for the car's heart button. Filled from the
 *  server's list (the Liked tab, or a look when the car connects) and kept
 *  up to date by the button itself. Null for a song whose state is not
 *  known yet. */
class LikedSongs {
    private var ids: Set<String>? = null

    @Synchronized fun isLiked(id: String?): Boolean? {
        if (id == null) return null
        return ids?.contains(id)
    }

    @Synchronized fun known(): Boolean = ids != null

    @Synchronized fun replace(all: Collection<String>) { ids = all.toHashSet() }

    @Synchronized fun set(id: String, liked: Boolean) {
        val now = ids?.toHashSet() ?: return
        if (liked) now.add(id) else now.remove(id)
        ids = now
    }
}
