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

    fun toMediaItem(track: JSONObject, baseUrl: String): MediaItem {
        val stream = track.optString("streamUrl")
        val uri = if (stream.startsWith("http")) stream else baseUrl + stream
        val artwork = track.optString("artworkUrl").takeIf { it.isNotBlank() }
        val extras = Bundle().apply { putString(EXTRA_TRACK, track.toString()) }
        val meta = MediaMetadata.Builder()
            .setTitle(track.optString("title"))
            .setArtist(track.optString("artist"))
            .setAlbumTitle(track.optString("album").takeIf { it.isNotBlank() && it != "null" })
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
