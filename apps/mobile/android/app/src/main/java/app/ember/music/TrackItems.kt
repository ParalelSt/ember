package app.ember.music

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject

/** Ember track JSON <-> Media3 MediaItem.
 *
 *  The full track JSON rides along in the item's extras: the car hands back
 *  only a mediaId when something is tapped, and the web UI wants whole tracks
 *  when the queue changes natively. One source of truth, no second cache. */
object TrackItems {
    const val EXTRA_TRACK = "ember.track"

    /** optString hands back the STRING "null" for a JSON null; treat it as absent. */
    private fun str(track: JSONObject, key: String): String =
        if (track.isNull(key)) "" else track.optString(key)

    fun toMediaItem(track: JSONObject, baseUrl: String): MediaItem {
        val stream = str(track, "streamUrl")
        val uri = if (stream.startsWith("http")) stream else baseUrl + stream
        val artwork = str(track, "artworkUrl").takeIf { it.isNotBlank() }
        val extras = Bundle().apply { putString(EXTRA_TRACK, track.toString()) }
        val meta = MediaMetadata.Builder()
            .setTitle(str(track, "title"))
            .setArtist(str(track, "artist"))
            .setAlbumTitle(str(track, "album").takeIf { it.isNotBlank() })
            .setArtworkUri(artwork?.let { Uri.parse(it) })
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .setExtras(extras)
            .build()
        return MediaItem.Builder()
            .setMediaId(track.getString("id"))
            .setUri(uri)
            .setMediaMetadata(meta)
            .build()
    }

    fun trackOf(item: MediaItem): JSONObject? =
        item.mediaMetadata.extras?.getString(EXTRA_TRACK)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun toJson(items: List<MediaItem>): JSONArray {
        val arr = JSONArray()
        items.forEach { item -> trackOf(item)?.let { arr.put(it) } }
        return arr
    }
}
