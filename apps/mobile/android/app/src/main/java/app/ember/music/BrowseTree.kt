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
    /** Every list shown, by the id of the folder it was shown in, so a tap
     *  plays the rest of that list too. The car loads more than one list
     *  before a tap (the tab it opens and the ones next to it), so "the list
     *  fetched last" was often another one. */
    private val lists = HashMap<String, List<JSONObject>>()

    /** A track in a list the car shows carries that list in its id
     *  ("liked|youtube:abc"), since the tap hands back only the id. Track ids
     *  never contain '|'; a search query in the folder id may. */
    private fun split(mediaId: String): Pair<String?, String> {
        val at = mediaId.lastIndexOf(SEP)
        return if (at < 0) null to mediaId else mediaId.substring(0, at) to mediaId.substring(at + 1)
    }

    fun trackById(mediaId: String): JSONObject? = synchronized(known) { known[split(mediaId).second] }

    /** The list the tapped track came from, from that track onward; or just
     *  the track when it was not part of a list we showed. */
    fun queueFor(mediaId: String): List<JSONObject> {
        val (parent, id) = split(mediaId)
        val list = parent?.let { synchronized(lists) { lists[it] } }.orEmpty()
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
        const val SEARCH_PREFIX = "search:"
        private const val SEP = '|'
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
        parentId == LIKED -> tracks(parentId, api.likes())
        parentId == RECENT -> tracks(parentId, api.history())
        parentId == UPLOADS -> tracks(parentId, api.uploads())
        parentId.startsWith(PLAYLIST_PREFIX) -> tracks(parentId, api.playlistTracks(parentId.removePrefix(PLAYLIST_PREFIX)))
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
        return tracks(SEARCH_PREFIX + query, results)
    }

    private fun tracks(parentId: String, list: List<JSONObject>): List<MediaItem> {
        synchronized(known) { list.forEach { known[it.optString("id")] = it } }
        synchronized(lists) { lists[parentId] = list }
        return list.map { track ->
            TrackItems.toMediaItem(track, api.baseUrl).buildUpon().setMediaId(parentId + SEP + track.optString("id")).build()
        }
    }
}
