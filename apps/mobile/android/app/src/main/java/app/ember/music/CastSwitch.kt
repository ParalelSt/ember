package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline

/** Moves the queue between the phone's player and a cast device, when a
 *  Cast session starts or ends (the CastPlayer's SessionAvailabilityListener).
 *
 *  Starting: the queue, the playing song, where it is, whether it plays and
 *  the repeat mode go to the TV; the phone's player stops (keeping its
 *  queue). Ending: whatever the TV had by then (the app or radio may have
 *  changed it) comes back to the phone, paused where the TV was. The
 *  session (the app, the notification, the lock screen) is pointed at
 *  whichever player plays through [onActive].
 *
 *  The session only moves to the TV once the TV HAS the queue. The songs
 *  are signed first (a network call) and the TV then reports its queue a
 *  moment later; pointed at the TV before that, the session would show the
 *  app an empty queue, and the app would take that as the queue being
 *  cleared. [whenApplied] runs its argument once the TV player has been
 *  handed everything asked of it so far (CastQueuePlayer.afterPending);
 *  [later] schedules the give-up for a TV that never reports its queue.
 *
 *  [onCasting] hears the moment the phone's player stops for the TV (true)
 *  and the moment it has the queue back (false): what sits on the phone's
 *  audio output (the loudness booster) lets go while the TV plays. */
class CastSwitch(
    private val local: Player,
    private val remote: Player,
    private val baseUrl: String,
    private val whenApplied: (() -> Unit) -> Unit = { it() },
    private val later: (Long, () -> Unit) -> Unit = { _, fn -> fn() },
    private val onCasting: (Boolean) -> Unit = {},
    private val onActive: (Player) -> Unit,
) {
    companion object {
        /** How long to wait for the TV to report the queue before the
         *  session moves anyway. */
        const val HANDOVER_TIMEOUT_MS = 8_000L

        fun snapshot(p: Player): Snapshot? {
            val items = (0 until p.mediaItemCount).map { p.getMediaItemAt(it) }
            if (items.isEmpty()) return null
            val index = p.currentMediaItemIndex.takeIf { it != C.INDEX_UNSET }?.coerceIn(0, items.size - 1) ?: 0
            return Snapshot(items, index, p.currentPosition.coerceAtLeast(0), p.playWhenReady, p.repeatMode)
        }
    }

    data class Snapshot(val items: List<MediaItem>, val index: Int, val positionMs: Long, val playWhenReady: Boolean, val repeatMode: Int)

    var casting = false
        private set

    /** The player that plays now. */
    val active: Player get() = if (casting) remote else local

    /** Which player the session is on (it trails [active] during a handover). */
    var sessionOn: Player = local
        private set

    /** What the TV last had, kept while casting: a TV stopped from the TV
     *  itself or from Google Home can report an empty queue before the
     *  session ends, and the phone must still get the queue back. */
    private var lastRemote: Snapshot? = null
    private var handover = 0

    private val remoteWatch = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = remember()
        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            remember()
            if (!timeline.isEmpty) moveSession(handover)
        }
    }

    init {
        remote.addListener(remoteWatch)
    }

    /** Called often while casting: the last good view of the TV's queue. */
    fun remember() {
        if (casting) snapshot(remote)?.let { lastRemote = it }
    }

    private fun moveSession(token: Int) {
        if (!casting || token != handover || sessionOn === remote) return
        sessionOn = remote
        onActive(remote)
    }

    fun toRemote() {
        if (casting) return
        val s = snapshot(local)
        casting = true
        lastRemote = s
        val token = ++handover
        local.stop()
        onCasting(true)
        if (s == null) {
            moveSession(token)
            return
        }
        remote.repeatMode = s.repeatMode
        remote.playWhenReady = s.playWhenReady
        remote.setMediaItems(s.items, s.index, s.positionMs)
        remote.prepare()
        whenApplied {
            if (remote.mediaItemCount > 0) moveSession(token)
        }
        later(HANDOVER_TIMEOUT_MS) { moveSession(token) }
    }

    /** A session that was already there when the service started: the TV
     *  keeps playing what it plays; the phone just follows it. */
    fun adoptRemote() {
        if (casting) return
        casting = true
        lastRemote = snapshot(remote)
        local.stop()
        onCasting(true)
        moveSession(++handover)
    }

    fun toLocal() {
        if (!casting) return
        val s = snapshot(remote) ?: lastRemote
        casting = false
        handover++
        lastRemote = null
        // The queue first, then the session: the app must never be shown
        // the phone's stale pre-cast queue on the way back.
        if (s != null) {
            local.playWhenReady = false
            local.setMediaItems(s.items.map { CastItems.forLocal(it, baseUrl) }, s.index, s.positionMs)
            local.repeatMode = s.repeatMode
            local.prepare()
        }
        onCasting(false)
        if (sessionOn !== local) {
            sessionOn = local
            onActive(local)
        }
    }
}
