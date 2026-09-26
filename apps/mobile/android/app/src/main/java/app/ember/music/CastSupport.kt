package app.ember.music

import android.content.Context
import android.net.Uri
import androidx.media3.cast.MediaItemConverter
import androidx.media3.common.MediaItem
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions
import com.google.android.gms.common.images.WebImage
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** The Google Cast framework's settings (named in the manifest).
 *
 *  Google's Default Media Receiver: it shows the title, artist, album and
 *  cover on the TV, and there is no receiver app of our own to host. The
 *  framework's own media session and notification are off: Media3's session
 *  (the lock screen, the notification, the app, the car) follows the
 *  CastPlayer instead, so there is one set of controls, not two. */
class EmberCastOptions : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions = CastOptions.Builder()
        .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
        .setStopReceiverApplicationWhenEndingSession(true)
        .setResumeSavedSession(false)
        .setEnableReconnectionService(false)
        .setCastMediaOptions(CastMediaOptions.Builder().setMediaSessionEnabled(false).setNotificationOptions(null).build())
        .build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}

/** One song as a cast device gets it, from POST /api/cast/sign: links the
 *  device can fetch without the Ember cookie, valid until [expiresAtSec]. */
data class CastLink(val streamUrl: String, val artworkUrl: String?, val contentType: String, val expiresAtSec: Long)

object CastItems {
    const val DEFAULT_MIME = "audio/mp4"
    private val SIGNABLE = Regex("^(youtube:[A-Za-z0-9_-]{11}|upload:[A-Za-z0-9]{1,40})$")

    /** Only YouTube songs and uploads can be signed (the server's rule too). */
    fun signable(id: String): Boolean = SIGNABLE.matches(id)

    /** `{ expiresAt, items: { id: { streamUrl, artworkUrl, contentType } } }`. */
    fun parseSignResponse(json: JSONObject): Map<String, CastLink> {
        val expires = json.optLong("expiresAt", 0)
        val items = json.optJSONObject("items") ?: return emptyMap()
        val out = HashMap<String, CastLink>()
        for (id in items.keys()) {
            val o = items.optJSONObject(id) ?: continue
            val stream = o.optString("streamUrl").takeIf { it.startsWith("http") } ?: continue
            val art = if (o.isNull("artworkUrl")) null else o.optString("artworkUrl").takeIf { it.startsWith("http") }
            out[id] = CastLink(stream, art, o.optString("contentType").ifBlank { DEFAULT_MIME }, expires)
        }
        return out
    }

    /** [item] as the TV plays it: the signed stream, its content type, and a
     *  cover the TV can load by itself (an upload's signed one; a cover on
     *  Google's hosts as it is; never one on the Ember server that needs the
     *  cookie). Without a link it stays as it was: the TV then fails that
     *  song and the queue moves on (QueueListener). */
    fun forCast(item: MediaItem, link: CastLink?, baseUrl: String): MediaItem {
        if (link == null) return item
        val art = link.artworkUrl?.let { Uri.parse(it) }
            ?: item.mediaMetadata.artworkUri?.takeIf { it.scheme == "https" || it.scheme == "http" }
                ?.takeIf { !ArtworkSources.isServer(it, baseUrl) }
        return item.buildUpon()
            .setUri(link.streamUrl)
            .setMimeType(link.contentType)
            .setMediaMetadata(item.mediaMetadata.buildUpon().setArtworkUri(art).build())
            .build()
    }

    /** And back: the phone's own item for a song that was on the TV, rebuilt
     *  from the track it carries (the phone streams with the cookie, and
     *  finds a downloaded copy by its id). */
    fun forLocal(item: MediaItem, baseUrl: String): MediaItem =
        TrackItems.trackOf(item)?.let { runCatching { TrackItems.toMediaItem(it, baseUrl) }.getOrNull() } ?: item
}

/** MediaItem <-> the Cast queue's MediaQueueItem. The CastPlayer keeps the
 *  MediaItems it was given (with the track JSON the app needs) and only
 *  sends this to the TV, so it stays small: a Cast message has a size
 *  limit, and a long queue is sent in one. */
class CastConverter : MediaItemConverter {
    override fun toMediaQueueItem(mediaItem: MediaItem): MediaQueueItem {
        val meta = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK)
        mediaItem.mediaMetadata.title?.let { meta.putString(MediaMetadata.KEY_TITLE, it.toString()) }
        mediaItem.mediaMetadata.artist?.let { meta.putString(MediaMetadata.KEY_ARTIST, it.toString()) }
        mediaItem.mediaMetadata.albumTitle?.let { meta.putString(MediaMetadata.KEY_ALBUM_TITLE, it.toString()) }
        mediaItem.mediaMetadata.artworkUri?.let { meta.addImage(WebImage(it)) }
        val uri = mediaItem.localConfiguration?.uri?.toString().orEmpty()
        val info = MediaInfo.Builder(uri)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(mediaItem.localConfiguration?.mimeType ?: CastItems.DEFAULT_MIME)
            .setMetadata(meta)
            .setCustomData(JSONObject().put(KEY_ID, mediaItem.mediaId))
            .build()
        return MediaQueueItem.Builder(info).setAutoplay(true).build()
    }

    /** Only for an item the CastPlayer did not send itself (it keeps its
     *  own): rebuilt from what the TV has. */
    override fun toMediaItem(mediaQueueItem: MediaQueueItem): MediaItem {
        val info = mediaQueueItem.media ?: return MediaItem.EMPTY
        val meta = info.metadata
        val id = info.customData?.optString(KEY_ID).orEmpty()
        val sep = id.indexOf(':')
        val source = if (sep > 0) id.substring(0, sep) else "youtube"
        val sourceId = if (sep > 0) id.substring(sep + 1) else id
        val track = JSONObject()
            .put("id", id)
            .put("source", source)
            .put("sourceId", sourceId)
            .put("title", meta?.getString(MediaMetadata.KEY_TITLE) ?: "")
            .put("artist", meta?.getString(MediaMetadata.KEY_ARTIST) ?: "")
            .put("album", meta?.getString(MediaMetadata.KEY_ALBUM_TITLE) ?: JSONObject.NULL)
            .put("artistId", JSONObject.NULL)
            .put("albumId", JSONObject.NULL)
            .put("durationSec", 0)
            .put("artworkUrl", meta?.images?.firstOrNull()?.url?.toString() ?: JSONObject.NULL)
            .put("streamUrl", if (source == "upload") "/api/uploads/$sourceId/stream" else "/api/youtube/stream/$sourceId")
        val base = if (id.isNotEmpty()) TrackItems.toMediaItem(track, "") else MediaItem.Builder().build()
        return base.buildUpon().setUri(info.contentId).setMimeType(info.contentType).build()
    }

    companion object {
        const val KEY_ID = "id"
    }
}

/** Signed links, fetched from the server and reused while they have an hour
 *  or more left, so a song never starts on a link about to die. [fetch]
 *  runs off the main thread (a network call). */
class CastSigner(
    private val fetch: (List<String>) -> Map<String, CastLink>,
    private val nowSec: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    companion object {
        const val REUSE_MARGIN_SEC = 60 * 60L
        /** The server's limit per call. */
        const val MAX_PER_CALL = 500
    }

    private val links = ConcurrentHashMap<String, CastLink>()

    /** Forgets every link: they were signed for whoever was signed in when
     *  the session started, and the next session may be someone else's. */
    fun clear() = links.clear()

    fun fresh(id: String): CastLink? = links[id]?.takeIf { it.expiresAtSec - nowSec() > REUSE_MARGIN_SEC }

    /** The signable ids among [ids] with no fresh link yet. */
    fun missing(ids: List<String>): List<String> = ids.distinct().filter { CastItems.signable(it) && fresh(it) == null }

    /** Blocking: asks the server for [ids]. */
    fun sign(ids: List<String>) {
        for (chunk in ids.distinct().chunked(MAX_PER_CALL)) links.putAll(fetch(chunk))
    }
}
