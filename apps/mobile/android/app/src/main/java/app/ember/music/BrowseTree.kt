package app.ember.music

import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaConstants
import org.json.JSONObject
import java.io.IOException

/** What the car can browse. Android Auto renders its own UI from this tree;
 *  we only supply ids, titles, covers and playability. Lists are fetched on
 *  demand, each tab straight from the API the web app already uses.
 *
 *  Four tabs (Android Auto shows at most four): Home (recently played and a
 *  few playlists), Liked songs, Playlists, and Library (recently played,
 *  uploads, and the songs downloaded to the phone). A list longer than
 *  [PAGE_SIZE] comes in folders of that many ("Songs 1-100"), which the car
 *  pages through; a tap still plays on through the whole list.
 *
 *  Offline, the server's lists are replaced by what is on the phone, and a
 *  search looks through the downloads. */
class BrowseTree(
    private val api: ServerApi,
    /** ArtworkProvider's authority: covers on the Ember server go out as
     *  content URIs the car can load (ArtworkUris). Null keeps https. */
    private val artAuthority: String? = null,
    /** The songs downloaded to the phone (OfflineStore), as track JSON. */
    private val downloads: () -> List<JSONObject> = { emptyList() },
    /** Whether a downloaded song has its own cover on the phone. */
    private val downloadedArt: (String) -> Boolean = { false },
    /** Whether the phone has a network; asked on every list. */
    private val online: () -> Boolean = { true },
    /** Every liked song's id, whenever the Liked tab is fetched (the car's
     *  heart button shows it). */
    private val onLiked: (List<String>) -> Unit = {},
) {
    /** Every track the car has been shown, by id. A tap from a legacy browser
     *  (Android Auto, the car Media Center) hands back only the mediaId, so the
     *  full track has to be looked up here. */
    private val known = HashMap<String, JSONObject>()
    /** Every list shown, by the id of the folder it was shown in, so a tap
     *  plays the rest of that list too. The car loads more than one list
     *  before a tap (the tab it opens and the ones next to it), so "the list
     *  fetched last" was often another one. A paged list is kept whole, under
     *  its own id. */
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
        const val HOME = "home"
        const val LIKED = "liked"
        const val PLAYLISTS = "playlists"
        const val LIBRARY = "library"
        const val RECENT = "recent"
        const val UPLOADS = "uploads"
        const val DOWNLOADS = "downloads"
        const val HOME_RECENT = "home-recent"
        const val PLAYLIST_PREFIX = "playlist:"
        const val SEARCH_PREFIX = "search:"
        private const val SEP = '|'
        /** "liked~2": the third page of Liked songs. */
        private const val PAGE_SEP = '~'
        /** Songs per page folder. Android Auto shows a few hundred items at
         *  most, and a big list also has to cross to the car in one piece. */
        const val PAGE_SIZE = 100
        const val HOME_RECENT_COUNT = 10
        const val HOME_PLAYLIST_COUNT = 8

        /** Media3's paging ([page], [pageSize]) over a list the tree built
         *  whole. A legacy browser asks for page 0 of Int.MAX_VALUE. */
        fun page(items: List<MediaItem>, page: Int, pageSize: Int): List<MediaItem> {
            if (page < 0 || pageSize <= 0) return items
            val from = page.toLong() * pageSize
            if (from >= items.size) return emptyList()
            val to = minOf(items.size.toLong(), from + pageSize)
            return items.subList(from.toInt(), to.toInt())
        }

        /** The root tabs a car that shows [limit] of them gets (0 or less:
         *  no limit given). */
        fun tabsFor(limit: Int): List<String> {
            val all = listOf(HOME, LIKED, PLAYLISTS, LIBRARY)
            return if (limit in 1 until all.size) all.take(limit) else all
        }

        /** Extras that ask the car for list rows or a grid. */
        fun styleExtras(browsable: Int? = null, playable: Int? = null, group: String? = null): Bundle = Bundle().apply {
            browsable?.let { putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, it) }
            playable?.let { putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, it) }
            group?.let { putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, it) }
        }

        /** The root's own extras, handed to the car with it: lists by
         *  default, and the car may search. */
        fun rootExtras(): Bundle = styleExtras(
            browsable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            playable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
        ).apply { putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true) }

        /** A server list that failed, as the one line the car shows. */
        fun failureText(e: Throwable): String =
            if (e.message?.contains("-> 401") == true || e.message?.contains("-> 403") == true) "Sign in to Ember on your phone"
            else "Can't reach Ember. Try again in a moment"
    }

    private fun folder(id: String, title: String, extras: Bundle? = null, artworkUri: android.net.Uri? = null, subtitle: String? = null): MediaItem =
        MediaItem.Builder().setMediaId(id)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setSubtitle(subtitle).setIsBrowsable(true).setIsPlayable(false)
                .setArtworkUri(artworkUri)
                .setExtras(extras)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()).build()

    /** A non-playable, non-browsable line the car shows as a message. */
    fun placeholder(text: String): MediaItem = MediaItem.Builder().setMediaId("msg:" + text.hashCode())
        .setMediaMetadata(MediaMetadata.Builder().setTitle(text).setIsBrowsable(false).setIsPlayable(false).build()).build()

    fun root(): MediaItem = folder(ROOT, "Ember")

    fun children(parentId: String, rootLimit: Int = 0): List<MediaItem> {
        val (base, pageIndex) = splitPage(parentId)
        if (pageIndex != null) return pageOf(base, pageIndex)
        return when {
            parentId == ROOT -> tabsFor(rootLimit).map(::tab)
            parentId == HOME -> home()
            parentId == LIBRARY -> listOf(
                folder(RECENT, "Recently played"),
                folder(UPLOADS, "Uploads"),
                folder(DOWNLOADS, "On this phone"),
            )
            parentId == DOWNLOADS -> downloadsList()
            !online() -> offline()
            parentId == PLAYLISTS -> api.playlists().map(::playlistFolder)
            parentId == LIKED -> api.likes().let { list ->
                onLiked(list.map { it.optString("id") })
                tracks(parentId, list)
            }
            parentId == RECENT -> tracks(parentId, distinct(api.history()))
            parentId == UPLOADS -> tracks(parentId, api.uploads())
            parentId.startsWith(PLAYLIST_PREFIX) -> tracks(parentId, api.playlistTracks(parentId.removePrefix(PLAYLIST_PREFIX)))
            else -> emptyList()
        }
    }

    private fun tab(id: String): MediaItem = when (id) {
        HOME -> folder(HOME, "Home")
        LIKED -> folder(LIKED, "Liked songs")
        PLAYLISTS -> folder(PLAYLISTS, "Playlists", styleExtras(browsable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM))
        else -> folder(LIBRARY, "Library")
    }

    private fun playlistFolder(p: JSONObject): MediaItem {
        val art = p.optString("artwork_url").takeIf { !p.isNull("artwork_url") && it.isNotBlank() }
        val uri = art?.let { a ->
            artAuthority?.let { ArtworkUris.contentUriFor(a, api.baseUrl, it) }
                ?: android.net.Uri.parse(if (a.startsWith("/") && !a.startsWith("//")) api.baseUrl + a else a)
        }
        return folder(PLAYLIST_PREFIX + p.getString("id"), p.optString("name", "Playlist"), artworkUri = uri)
    }

    /** Home: what was played lately, then a few playlists, each under its
     *  own heading. A section that fails is left out; both failing is the
     *  usual one-line message. Offline: the songs on the phone. */
    private fun home(): List<MediaItem> {
        if (!online()) return offline()
        var failure: Throwable? = null
        val recent = runCatching { distinct(api.history()).take(HOME_RECENT_COUNT) }.onFailure { failure = it }.getOrNull()
        val playlists = runCatching { api.playlists().take(HOME_PLAYLIST_COUNT) }.onFailure { failure = it }.getOrNull()
        if (recent == null && playlists == null) throw failure ?: IOException("home")
        val out = ArrayList<MediaItem>()
        recent?.let { list ->
            out += tracks(HOME_RECENT, list, paged = false).map { withGroup(it, "Recently played") }
        }
        playlists?.let { list -> out += list.map { withGroup(playlistFolder(it), "Your playlists") } }
        if (out.isEmpty()) out += placeholder("Play something on your phone to see it here")
        return out
    }

    private fun withGroup(item: MediaItem, title: String): MediaItem {
        val extras = Bundle(item.mediaMetadata.extras ?: Bundle.EMPTY).apply {
            putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, title)
        }
        return item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setExtras(extras).build()).build()
    }

    /** A song listened to twice shows once, at its latest play. */
    private fun distinct(list: List<JSONObject>): List<JSONObject> {
        val seen = HashSet<String>()
        return list.filter { seen.add(it.optString("id")) }
    }

    private fun downloadsList(): List<MediaItem> {
        val list = downloads()
        if (list.isEmpty()) return listOf(placeholder("No songs downloaded to this phone"))
        return tracks(DOWNLOADS, list)
    }

    /** Any server list with no network: say so, and offer what is on the
     *  phone. */
    private fun offline(): List<MediaItem> {
        val list = downloads()
        val head = placeholder(if (list.isEmpty()) "You're offline" else "You're offline. Songs on this phone:")
        return listOf(head) + if (list.isEmpty()) emptyList() else tracks(DOWNLOADS, list, paged = false)
    }

    /** "liked~2" -> ("liked", 2); anything else -> (id, null). A playlist or
     *  search id may hold '~' itself, so only a number after the last one is
     *  a page. */
    private fun splitPage(id: String): Pair<String, Int?> {
        val at = id.lastIndexOf(PAGE_SEP)
        if (at <= 0) return id to null
        val n = id.substring(at + 1).toIntOrNull() ?: return id to null
        return id.substring(0, at) to n
    }

    private fun pageOf(base: String, index: Int): List<MediaItem> {
        // Asked for straight away after a restart (the car remembers where it
        // was): fetch the whole list again first.
        val list = synchronized(lists) { lists[base] } ?: run {
            if (base.startsWith(SEARCH_PREFIX)) search(base.removePrefix(SEARCH_PREFIX)) else children(base)
            synchronized(lists) { lists[base] }
        } ?: return emptyList()
        val from = index * PAGE_SIZE
        if (index < 0 || from >= list.size) return emptyList()
        return list.subList(from, minOf(list.size, from + PAGE_SIZE)).map { trackItem(base, it) }
    }

    /** The car searches on every keystroke, and Media3 asks twice per query
     *  (onSearch for the count, onGetSearchResult for the list). Against a
     *  server that allows 40 searches a minute that was a 429 by the time the
     *  driver finished typing. So: nothing below three characters, and one
     *  network call per distinct query. Offline, the downloads are searched. */
    @Volatile private var lastSearch: Pair<String, List<JSONObject>>? = null

    fun search(q: String): List<MediaItem> {
        val query = q.trim()
        if (query.length < 3) return emptyList()
        if (!online()) {
            val needle = query.lowercase()
            val hits = downloads().filter {
                it.optString("title").lowercase().contains(needle) || it.optString("artist").lowercase().contains(needle)
            }
            return if (hits.isEmpty()) listOf(placeholder("You're offline. Nothing on this phone matches")) else tracks(SEARCH_PREFIX + query, hits)
        }
        val cached = lastSearch
        val results = if (cached != null && cached.first == query) cached.second else api.search(query).also { lastSearch = query to it }
        return tracks(SEARCH_PREFIX + query, results)
    }

    private fun tracks(parentId: String, list: List<JSONObject>, paged: Boolean = true): List<MediaItem> {
        synchronized(known) { list.forEach { known[it.optString("id")] = it } }
        synchronized(lists) { lists[parentId] = list }
        if (paged && list.size > PAGE_SIZE) {
            return (0 until (list.size + PAGE_SIZE - 1) / PAGE_SIZE).map { i ->
                val from = i * PAGE_SIZE + 1
                val to = minOf(list.size, (i + 1) * PAGE_SIZE)
                folder("$parentId$PAGE_SEP$i", "Songs $from–$to",
                    styleExtras(playable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM),
                    subtitle = list[from - 1].optString("title").takeIf { it.isNotBlank() })
            }
        }
        return list.map { trackItem(parentId, it) }
    }

    /** A song as the car lists it: title, artist, cover and length, and
     *  whether it is on the phone. The track JSON stays here (known): a list
     *  of a few hundred songs has to cross to the car in one binder call. */
    private fun trackItem(parentId: String, track: JSONObject): MediaItem {
        val id = track.optString("id")
        val meta = TrackItems.metadata(track, api.baseUrl, artAuthority)
        // The phone's own copy of the cover, where the server's cannot be
        // reached (or for the downloads, which may be all there is).
        if (artAuthority != null && (parentId == DOWNLOADS || !online()) && downloadedArt(id)) {
            meta.setArtworkUri(ArtworkUris.trackUri(id, artAuthority))
        }
        if (parentId == DOWNLOADS) {
            meta.setExtras(Bundle().apply { putLong(MediaConstants.EXTRAS_KEY_DOWNLOAD_STATUS, MediaConstants.EXTRAS_VALUE_STATUS_DOWNLOADED) })
        }
        return MediaItem.Builder().setMediaId(parentId + SEP + id).setMediaMetadata(meta.build()).build()
    }
}
