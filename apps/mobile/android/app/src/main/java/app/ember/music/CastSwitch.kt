package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player

/** Moves the queue between the phone's player and a cast device, when a
 *  Cast session starts or ends (the CastPlayer's SessionAvailabilityListener).
 *
 *  Starting: the queue, the playing song, where it is, whether it plays and
 *  the repeat mode go to the TV; the phone's player stops (keeping its
 *  queue). Ending: whatever the TV had by then (the app or radio may have
 *  changed it) comes back to the phone, paused where the TV was. The
 *  session (the app, the notification, the lock screen) is pointed at
 *  whichever player plays through [onActive]. */
class CastSwitch(
    private val local: Player,
    private val remote: Player,
    private val baseUrl: String,
    private val onActive: (Player) -> Unit,
) {
    data class Snapshot(val items: List<MediaItem>, val index: Int, val positionMs: Long, val playWhenReady: Boolean, val repeatMode: Int)

    var casting = false
        private set

    /** The player that plays now. */
    val active: Player get() = if (casting) remote else local

    fun toRemote() {
        if (casting) return
        val s = snapshot(local)
        casting = true
        local.stop()
        onActive(remote)
        if (s == null) return
        remote.repeatMode = s.repeatMode
        remote.playWhenReady = s.playWhenReady
        remote.setMediaItems(s.items, s.index, s.positionMs)
        remote.prepare()
    }

    /** A session that was already there when the service started: the TV
     *  keeps playing what it plays; the phone just follows it. */
    fun adoptRemote() {
        if (casting) return
        casting = true
        local.stop()
        onActive(remote)
    }

    fun toLocal() {
        if (!casting) return
        val s = snapshot(remote)
        casting = false
        onActive(local)
        if (s == null) return
        local.playWhenReady = false
        local.setMediaItems(s.items.map { CastItems.forLocal(it, baseUrl) }, s.index, s.positionMs)
        local.repeatMode = s.repeatMode
        local.prepare()
    }

    companion object {
        fun snapshot(p: Player): Snapshot? {
            val items = (0 until p.mediaItemCount).map { p.getMediaItemAt(it) }
            if (items.isEmpty()) return null
            val index = p.currentMediaItemIndex.takeIf { it != C.INDEX_UNSET }?.coerceIn(0, items.size - 1) ?: 0
            return Snapshot(items, index, p.currentPosition.coerceAtLeast(0), p.playWhenReady, p.repeatMode)
        }
    }
}
