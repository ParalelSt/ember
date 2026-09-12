package app.ember.music

import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONObject

/** What the car can browse. Android Auto renders its own UI from this tree;
 *  we only supply ids, titles and playability. Lists are fetched on demand,
 *  each tab straight from the API the web app already uses. */
class BrowseTree(private val api: ServerApi) {
    /** Every track the car has been shown, by id. A tap from a legacy browser
     *  (Android Auto, the car Media Center) hands back only the mediaId, so the
     *  full track has to be looked up here. */
    private val known = HashMap<String, JSONObject>()
    /** The list most recently shown, so a tap plays the rest of it too. */
    @Volatile private var lastList: List<JSONObject> = emptyList()

    fun trackById(id: String): JSONObject? = synchronized(known) { known[id] }

    /** The list the tapped track came from, from that track onward; or just
     *  the track when it was not part of a list we showed. */
    fun queueFor(id: String): List<JSONObject> {
        val list = lastList
        val i = list.indexOfFirst { it.optString("id") == id }
        if (i >= 0) return list.drop(i)
        return listOfNotNull(trackById(id))
    }

    companion object {
        const val ROOT = "root"
        const val PLAYLISTS = "playlists"
        const val LIKED = "liked"
        const val RECENT = "recent"
        const val UPLOADS = "uploads"
        const val PLAYLIST_PREFIX = "playlist:"
    }

    private fun folder(id: String, title: String): MediaItem = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()).build()

    /** A non-playable, non-browsable line the car shows as a message. */
    fun placeholder(text: String): MediaItem = MediaItem.Builder().setMediaId("msg:" + text.hashCode())
        .setMediaMetadata(MediaMetadata.Builder().setTitle(text).setIsBrowsable(false).setIsPlayable(false).build()).build()

    fun root(): MediaItem = folder(ROOT, "Ember")

    fun children(parentId: String): List<MediaItem> = when {
        parentId == ROOT -> listOf(folder(PLAYLISTS, "Playlists"), folder(LIKED, "Liked songs"), folder(RECENT, "Recently played"), folder(UPLOADS, "Uploads"))
        parentId == PLAYLISTS -> api.playlists().map { folder(PLAYLIST_PREFIX + it.getString("id"), it.optString("name", "Playlist")) }
        parentId == LIKED -> tracks(api.likes())
        parentId == RECENT -> tracks(api.history())
        parentId == UPLOADS -> tracks(api.uploads())
        parentId.startsWith(PLAYLIST_PREFIX) -> tracks(api.playlistTracks(parentId.removePrefix(PLAYLIST_PREFIX)))
        else -> emptyList()
    }

    /** The car searches on every keystroke, and Media3 asks twice per query
     *  (onSearch for the count, onGetSearchResult for the list). Against a
     *  server that allows 40 searches a minute that was a 429 by the time the
     *  driver finished typing. So: nothing below three characters, and one
     *  network call per distinct query. */
    @Volatile private var lastSearch: Pair<String, List<JSONObject>>? = null

    fun search(q: String): List<MediaItem> {
        val query = q.trim()
        if (query.length < 3) return emptyList()
        val cached = lastSearch
        val results = if (cached != null && cached.first == query) cached.second else api.search(query).also { lastSearch = query to it }
        return tracks(results)
    }

    private fun tracks(list: List<JSONObject>): List<MediaItem> {
        synchronized(known) { list.forEach { known[it.optString("id")] = it } }
        lastList = list
        return list.map { TrackItems.toMediaItem(it, api.baseUrl) }
    }
}
