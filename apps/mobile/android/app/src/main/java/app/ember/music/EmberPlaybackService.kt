package app.ember.music

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.webkit.CookieManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executors

/** Ember's audio engine on Android, and the thing Android Auto talks to.
 *
 *  A MediaLibraryService so the car can browse; ExoPlayer for the audio;
 *  Media3 provides the notification, lock-screen and Bluetooth controls, and
 *  the foreground-service lifecycle. The queue lives HERE: the WebView is a
 *  client (see EmberPlayerPlugin) and may be destroyed while music plays. */
class EmberPlaybackService : MediaLibraryService() {
    companion object {
        const val TAG = "EmberPlayback"
        const val COMMAND_SHUFFLE = "ember.shuffle"
        const val COMMAND_REPEAT = "ember.repeat"
    }

    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession
    lateinit var api: ServerApi
    private lateinit var tree: BrowseTree
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate() {
        super.onCreate()
        val baseUrl = ServerConfig.baseUrl(this)
        api = ServerApi(baseUrl) { CookieManager.getInstance().getCookie(baseUrl) }
        tree = BrowseTree(api)
        // Streams go through the same OkHttp client, so they carry the cookie
        // and get the same 401 retry as the JSON calls.
        val dataSource = OkHttpDataSource.Factory(api.http)
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(dataSource))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                // Every item start is one play in history, car-initiated ones
                // included; the web app skips its own history call on Android.
                val track = item?.let { TrackItems.trackOf(it) } ?: return
                io.execute { runCatching { api.recordPlay(track) }.onFailure { Log.w(TAG, "history: ${it.message}") } }
                maybeExtendQueue()
            }
        })
        session = MediaLibrarySession.Builder(this, player, Callback()).build()
        // Shuffle and repeat as buttons on the now-playing screen (car + notification).
        session.setCustomLayout(ImmutableList.of(
            androidx.media3.session.CommandButton.Builder().setDisplayName("Shuffle").setIconResId(android.R.drawable.ic_menu_rotate).setSessionCommand(SessionCommand(COMMAND_SHUFFLE, Bundle.EMPTY)).build(),
            androidx.media3.session.CommandButton.Builder().setDisplayName("Repeat").setIconResId(android.R.drawable.ic_menu_revert).setSessionCommand(SessionCommand(COMMAND_REPEAT, Bundle.EMPTY)).build(),
        ))
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    /** Never fall silent in the car: when the last item starts playing, pull
     *  recommendations seeded by it and append them, minus anything already
     *  queued. Mirrors the web app's radio in the simplest form; the web app's
     *  own extension (when its UI is alive) reaches here through setQueue and
     *  wins by arriving first, in which case this sees a non-last item and
     *  does nothing. */
    private fun maybeExtendQueue() {
        if (player.repeatMode != Player.REPEAT_MODE_OFF) return
        if (player.currentMediaItemIndex != player.mediaItemCount - 1) return
        val current = player.currentMediaItem?.let { TrackItems.trackOf(it) } ?: return
        if (current.optString("source") != "youtube") return
        val seed = current.optString("sourceId")
        val queued = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }.toSet()
        io.execute {
            val more = runCatching { api.recommended(seed) }
                .getOrElse { Log.w(TAG, "radio: ${it.message}"); emptyList() }
                .filter { it.optString("id") !in queued }
                .take(20)
                .map { TrackItems.toMediaItem(it, api.baseUrl) }
            Log.i(TAG, "radio after ${current.optString("title")}: +${more.size}")
            if (more.isNotEmpty()) android.os.Handler(mainLooper).post { player.addMediaItems(more) }
        }
    }

    /** Run a browse fetch off the main thread and turn it into a LibraryResult.
     *  The car shows whatever list comes back, so failures become one-line
     *  items rather than an empty screen with no explanation. */
    private fun onIo(fn: () -> List<MediaItem>): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val future = com.google.common.util.concurrent.SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
        io.execute {
            val items: List<MediaItem> = try {
                if (CookieManager.getInstance().getCookie(api.baseUrl).isNullOrBlank()) listOf(tree.placeholder("Sign in on your phone"))
                else fn()
            } catch (e: Exception) {
                Log.w(TAG, "browse: ${e.message}")
                listOf(tree.placeholder("Can't reach Ember"))
            }
            future.set(LibraryResult.ofItemList(ImmutableList.copyOf(items), null))
        }
        return future
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiped away from recents while paused: nothing to keep alive.
        if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        session.release()
        player.release()
        io.shutdown()
        super.onDestroy()
    }

    inner class Callback : MediaLibrarySession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            Log.i(TAG, "connect from ${controller.packageName} (legacy=${controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION})")
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(SessionCommand(COMMAND_SHUFFLE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_REPEAT, Bundle.EMPTY))
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build()
        }

        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            when (command.customAction) {
                COMMAND_SHUFFLE -> player.shuffleModeEnabled = !player.shuffleModeEnabled
                COMMAND_REPEAT -> player.repeatMode = when (player.repeatMode) {
                    Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                    Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                    else -> Player.REPEAT_MODE_OFF
                }
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        /** A controller (the car, or a plugin call) may hand over items that
         *  carry only a mediaId. Rebuild the playable item from the JSON that
         *  rides in the extras, or drop what we cannot resolve. */
        override fun onAddMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, items: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(items.mapNotNull(::resolve).toMutableList())

        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
            Log.i(TAG, "root for ${browser.packageName} recent=${params?.isRecent} suggested=${params?.isSuggested}")
            return Futures.immediateFuture(LibraryResult.ofItem(tree.root(), params))
        }
        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            Log.i(TAG, "children of $parentId for ${browser.packageName}")
            return onIo { tree.children(parentId) }
        }
        override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
        override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
            io.execute {
                val n = runCatching { tree.search(query).size }.getOrElse { Log.w(TAG, "search: ${it.message}"); 0 }
                Log.i(TAG, "search \"$query\" for ${browser.packageName} -> $n")
                session.notifySearchResultChanged(browser, query, n, params)
            }
            return Futures.immediateFuture(LibraryResult.ofVoid())
        }
        override fun onGetSearchResult(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            Log.i(TAG, "search results \"$query\" for ${browser.packageName}")
            return onIo { tree.search(query) }
        }
        /** The car tapped a track inside a list. A legacy browser sends ONE item
         *  with only its id, so play the rest of the list it was shown in too;
         *  the web app sends the whole queue with the track JSON attached. */
        override fun onSetMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, items: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val resolved: List<MediaItem> =
                if (items.size == 1 && items[0].localConfiguration == null && TrackItems.trackOf(items[0]) == null)
                    tree.queueFor(items[0].mediaId).map { TrackItems.toMediaItem(it, api.baseUrl) }
                else items.mapNotNull(::resolve)
            Log.i(TAG, "set ${items.size} item(s) from ${controller.packageName} -> queue of ${resolved.size}")
            return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(resolved, startIndex.coerceIn(0, maxOf(0, resolved.size - 1)), startPositionMs))
        }

        /** Playable item for whatever a controller handed us: already complete,
         *  carrying its track JSON, or just an id the car has seen before. */
        private fun resolve(item: MediaItem): MediaItem? {
            if (item.localConfiguration != null) return item
            val json = TrackItems.trackOf(item) ?: tree.trackById(item.mediaId) ?: return null
            return TrackItems.toMediaItem(json, api.baseUrl)
        }
    }
}
