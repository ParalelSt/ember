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

    /** [artAuthority]: ArtworkProvider's, to hand a cover on the Ember server
     *  out as a content URI the car can load (ArtworkUris); null keeps the
     *  https address (tests, and callers that never reach the car). */
    fun toMediaItem(track: JSONObject, baseUrl: String, artAuthority: String? = null): MediaItem {
        val stream = str(track, "streamUrl")
        val uri = if (stream.startsWith("http")) stream else baseUrl + stream
        val extras = Bundle().apply { putString(EXTRA_TRACK, track.toString()) }
        val meta = metadata(track, baseUrl, artAuthority).setExtras(extras).build()
        return MediaItem.Builder()
            .setMediaId(track.getString("id"))
            .setUri(uri)
            // The load key: how the player finds a downloaded copy (OfflineAudio).
            .setCustomCacheKey(track.getString("id"))
            .setMediaMetadata(meta)
            .build()
    }

    /** Title, artist, album, cover and length, without the track JSON: what
     *  the car's browse lists need (the JSON stays in BrowseTree). */
    fun metadata(track: JSONObject, baseUrl: String, artAuthority: String? = null): MediaMetadata.Builder {
        // An upload's cover is relative (/api/uploads/<id>/art), like its
        // stream; left relative, nothing could ever load it.
        val raw = str(track, "artworkUrl").takeIf { it.isNotBlank() }
        val artwork = raw?.let { art ->
            artAuthority?.let { ArtworkUris.contentUriFor(art, baseUrl, it) }
                ?: Uri.parse(if (art.startsWith("/") && !art.startsWith("//")) baseUrl + art else art)
        }
        // The catalog's length, so a head unit shows the song's length (and a
        // progress bar) before the stream has said how long it is.
        val durationMs = track.optDouble("durationSec", 0.0).takeIf { !it.isNaN() && it > 0 }?.let { (it * 1000).toLong() }
        return MediaMetadata.Builder()
            .setTitle(str(track, "title"))
            .setArtist(str(track, "artist"))
            .setAlbumTitle(str(track, "album").takeIf { it.isNotBlank() })
            .setArtworkUri(artwork)
            .setDurationMs(durationMs)
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
    }

    fun trackOf(item: MediaItem): JSONObject? =
        item.mediaMetadata.extras?.getString(EXTRA_TRACK)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun toJson(items: List<MediaItem>): JSONArray {
        val arr = JSONArray()
        items.forEach { item -> trackOf(item)?.let { arr.put(it) } }
        return arr
    }
}
