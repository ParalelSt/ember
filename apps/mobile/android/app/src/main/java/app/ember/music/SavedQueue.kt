package app.ember.music

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.session.MediaSession
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executor

/** The native queue on disk, so a "play" after Android has closed the app
 *  (the car's play button, a headset, the steering wheel) picks up the
 *  last queue where it was instead of doing nothing: Media3 asks the
 *  session for it (onPlaybackResumption) when play arrives with nothing
 *  loaded. The web app keeps its own copy for its own start. */
class SavedQueue(private val file: File) {
    data class Snapshot(val tracks: List<JSONObject>, val index: Int, val positionMs: Long)

    fun save(s: Snapshot) {
        val json = JSONObject()
            .put("index", s.index)
            .put("positionMs", s.positionMs)
            .put("tracks", JSONArray().apply { s.tracks.forEach { put(it) } })
        // Written whole then moved, so a kill mid-write leaves the last good one.
        val tmp = File(file.parentFile, file.name + ".part")
        tmp.writeText(json.toString())
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    fun load(): Snapshot? = runCatching {
        if (!file.exists()) return null
        val json = JSONObject(file.readText())
        val arr = json.getJSONArray("tracks")
        val tracks = (0 until arr.length()).map { arr.getJSONObject(it) }
        if (tracks.isEmpty()) return null
        Snapshot(tracks, json.optInt("index", 0).coerceIn(0, tracks.size - 1), json.optLong("positionMs", 0).coerceAtLeast(0))
    }.getOrNull()

    /** The playable items and where to start, for onPlaybackResumption. */
    fun resume(baseUrl: String): MediaSession.MediaItemsWithStartPosition? {
        val s = load() ?: return null
        val items = s.tracks.mapNotNull { runCatching { TrackItems.toMediaItem(it, baseUrl) }.getOrNull() }
        if (items.size != s.tracks.size) return null
        return MediaSession.MediaItemsWithStartPosition(items, s.index, s.positionMs)
    }

    companion object {
        /** What [player] has now; null when there is nothing to keep. */
        fun snapshotOf(player: Player): Snapshot? {
            val items = (0 until player.mediaItemCount).map { player.getMediaItemAt(it) }
            val tracks = items.mapNotNull { TrackItems.trackOf(it) }
            // An item without its track (never happens for our own items)
            // would shift every index after it: keep nothing rather than lie.
            if (tracks.isEmpty() || tracks.size != items.size) return null
            val index = player.currentMediaItemIndex.takeIf { it != C.INDEX_UNSET } ?: 0
            return Snapshot(tracks, index, player.currentPosition.coerceAtLeast(0))
        }
    }

    /** Saves after every change worth keeping: the queue, the song, and the
     *  moment playback stops (the position). The snapshot is taken on the
     *  player's thread, the file written on [io]. */
    inner class Saver(private val player: Player, private val io: Executor) : Player.Listener {
        private fun saveNow() {
            val s = snapshotOf(player) ?: return
            io.execute { runCatching { save(s) }.onFailure { Log.w(EmberPlaybackService.TAG, "saved queue: ${it.message}") } }
        }
        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) saveNow()
        }
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = saveNow()
        override fun onIsPlayingChanged(isPlaying: Boolean) = saveNow()
        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK) saveNow()
        }
    }
}
