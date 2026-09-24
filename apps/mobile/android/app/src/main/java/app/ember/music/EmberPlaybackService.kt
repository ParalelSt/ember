package app.ember.music

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.webkit.CookieManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.SimpleCache
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
        /** Auto cache settings from the web UI: `enabled`, `onMetered`. */
        const val COMMAND_AUTO_CACHE = "ember.autoCache"
        /** `{ bytes, count, cap }` of the auto cache. */
        const val COMMAND_CACHE_STATS = "ember.cacheStats"
        const val COMMAND_CACHE_CLEAR = "ember.cacheClear"
        /** Where the queue came from (`contextType`, `baseCount`), for
         *  loop-all's wrap point in the prefetch window. */
        const val COMMAND_QUEUE_CONTEXT = "ember.queueContext"
        /** Session extras the plugin mirrors into its state. */
        const val EXTRA_CACHED_IDS = "cachedIds"
        const val EXTRA_OFFLINE_STALLED = "offlineStalled"
        const val EXTRA_OFFLINE = "offline"
        private const val PREFS = "ember.autoCache"
        private const val TICK_MS = 5_000L
        /** Buffered this far ahead, the song is not waiting on the network. */
        private const val SETTLED_AHEAD_MS = 30_000L

        /** Whether the current song is loaded far enough that a prefetch
         *  will not compete with it. Media3 buffers ~50 s ahead, so "loaded to
         *  the end" alone would hold every prefetch until a song's last 50 s;
         *  a full buffer means the player is not waiting on the network
         *  either. null when the length is unknown (the policy then waits
         *  for 45 s of play instead). */
        fun settled(durationMs: Long, bufferedMs: Long, aheadMs: Long, wholeOnDisk: Boolean): Boolean? = when {
            wholeOnDisk -> true
            durationMs == C.TIME_UNSET || durationMs <= 0 -> null
            bufferedMs >= durationMs - 1_000 -> true
            else -> aheadMs >= SETTLED_AHEAD_MS
        }

        /** Window indexes in play order (the car's shuffle button shuffles
         *  natively; the web app's shuffle is already in the queue order). */
        fun playOrder(timeline: Timeline, shuffle: Boolean): List<Int> {
            val out = ArrayList<Int>(timeline.windowCount)
            var i = timeline.getFirstWindowIndex(shuffle)
            while (i != C.INDEX_UNSET && out.size < timeline.windowCount) {
                out.add(i)
                i = timeline.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, shuffle)
            }
            return out
        }

        /** The policy's view of one queue item: its id, the absolute stream
         *  URL (null when the track has none), and whether the server has
         *  flagged it. */
        fun policyTrack(item: MediaItem): AutoCachePolicy.Track {
            val json = TrackItems.trackOf(item)
            fun str(k: String) = json?.takeIf { it.has(k) && !it.isNull(k) }?.optString(k)?.takeIf { it.isNotEmpty() }
            val stream = if (json == null || str("streamUrl") != null) item.localConfiguration?.uri?.toString() else null
            return AutoCachePolicy.Track(item.mediaId, stream, str("unavailableAt"))
        }

        /** The music player: streams (through the auto cache, see MediaCache),
         *  or the downloaded copy when there is one (OfflineAudio). Its own
         *  function so tests build the same one. */
        fun buildPlayer(context: Context, streams: DataSource.Factory, offline: OfflineStore): ExoPlayer =
            ExoPlayer.Builder(context)
                .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(OfflineAudio.dataSourceFactory(context, streams, offline)))
                .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .build()
    }

    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession
    lateinit var api: ServerApi
    private lateinit var tree: BrowseTree
    private lateinit var overlay: PrankOverlay
    private val io = Executors.newSingleThreadExecutor()
    /** Prefetch downloads and cache clearing, one at a time. */
    private val cacheIo = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var cache: SimpleCache
    private lateinit var offline: OfflineStore
    private lateinit var net: NetworkWatch
    private lateinit var autoCacher: AutoCacher
    private lateinit var offlinePlayback: OfflinePlayback
    private var queueContextType: String? = null
    private var queueBaseCount = 0
    private var publishedExtras: Triple<List<String>, Boolean, Boolean>? = null
    private val tickLoop = Runnable { cacheTick() }

    override fun onCreate() {
        super.onCreate()
        val baseUrl = ServerConfig.baseUrl(this)
        api = ServerApi(baseUrl) { CookieManager.getInstance().getCookie(baseUrl) }
        tree = BrowseTree(api)
        // Streams go through the same OkHttp client, so they carry the cookie
        // and get the same 401 retry as the JSON calls.
        val dataSource = OkHttpDataSource.Factory(api.http)
        cache = MediaCache.shared(this)
        offline = OfflineStore.shared(this)
        val streams = MediaCache.dataSourceFactory(cache, dataSource)
        player = buildPlayer(this, streams, offline)
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                // Every item start is one play in history, car-initiated ones
                // included; the web app skips its own history call on Android.
                val track = item?.let { TrackItems.trackOf(it) } ?: return
                io.execute { runCatching { api.recordPlay(track) }.onFailure { Log.w(TAG, "history: ${it.message}") } }
                maybeExtendQueue()
            }
        })
        overlay = PrankOverlay(this, player, dataSource, baseUrl)
        session = MediaLibrarySession.Builder(this, player, Callback()).build()
        startAutoCache(streams)
        // Shuffle and repeat as buttons on the now-playing screen (car + notification).
        session.setCustomLayout(ImmutableList.of(
            androidx.media3.session.CommandButton.Builder().setDisplayName("Shuffle").setIconResId(android.R.drawable.ic_menu_rotate).setSessionCommand(SessionCommand(COMMAND_SHUFFLE, Bundle.EMPTY)).build(),
            androidx.media3.session.CommandButton.Builder().setDisplayName("Repeat").setIconResId(android.R.drawable.ic_menu_revert).setSessionCommand(SessionCommand(COMMAND_REPEAT, Bundle.EMPTY)).build(),
        ))
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    // ── Auto cache and offline playback ─────────────────────────────────

    private fun startAutoCache(streams: androidx.media3.datasource.cache.CacheDataSource.Factory) {
        val store = object : AutoCacher.Store {
            override val cap = MediaCache.CAP_BYTES
            override fun fullyCached() = MediaCache.fullyCached(cache)
            override fun sizes() = MediaCache.sizes(cache)
        }
        autoCacher = AutoCacher(
            store = store,
            downloads = AutoCacher.cacheWriterDownloads(streams),
            executor = cacheIo,
            main = { handler.post(it) },
            snapshot = ::cacheSnapshot,
            onCached = { publishCacheState() },
        )
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        // Defaults per the owner: on, but never on mobile data unless asked.
        autoCacher.setSettings(prefs.getBoolean("enabled", true), prefs.getBoolean("onMetered", false))
        net = NetworkWatch(this) { state ->
            offlinePlayback.onNetwork(state.online)
            cacheTick()
        }
        offlinePlayback = OfflinePlayback(player, ::playableOffline, { net.current().online }) { publishCacheState() }
        player.addListener(offlinePlayback)
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) = cacheTick()
            override fun onIsPlayingChanged(isPlaying: Boolean) = cacheTick()
            override fun onTimelineChanged(timeline: Timeline, reason: Int) = cacheTick()
            override fun onRepeatModeChanged(repeatMode: Int) = cacheTick()
            override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = cacheTick()
        })
        net.start()
    }

    /** A song that can play without the network: pinned, or whole in the cache. */
    private fun playableOffline(item: MediaItem): Boolean {
        val id = item.mediaId
        if (item.localConfiguration?.uri?.scheme == "file") return true
        return offline.audioFileFor(id).exists() || MediaCache.isFullyCached(cache, id)
    }

    private fun cacheSnapshot(): AutoCacher.Snapshot? {
        val timeline = player.currentTimeline
        val current = player.currentMediaItemIndex
        if (timeline.isEmpty || current == C.INDEX_UNSET) return null
        val order = playOrder(timeline, player.shuffleModeEnabled)
        val index = order.indexOf(current)
        if (index < 0) return null
        val currentId = player.getMediaItemAt(current).mediaId
        return AutoCacher.Snapshot(
            queue = order.map { policyTrack(player.getMediaItemAt(it)) },
            index = index,
            loopMode = LoopModes.forCache(player.repeatMode),
            contextType = queueContextType,
            baseCount = queueBaseCount,
            playedSec = player.currentPosition / 1000.0,
            bufferedToEnd = settled(player.duration, player.bufferedPosition, player.totalBufferedDuration,
                offline.audioFileFor(currentId).exists() || MediaCache.isFullyCached(cache, currentId)),
            playing = player.isPlaying,
            net = net.current(),
            batterySaver = (getSystemService(POWER_SERVICE) as PowerManager?)?.isPowerSaveMode == true,
            isLocal = { offline.audioFileFor(it).exists() },
        )
    }

    /** Run the policy once and plan the next look: every 5 s while playing
     *  or downloading, or when a backoff ends. */
    private fun cacheTick() {
        handler.removeCallbacks(tickLoop)
        val action = runCatching { autoCacher.tick() }
            .onFailure { Log.w(AutoCacher.TAG, "tick: ${it.message}") }
            .getOrNull()
        publishCacheState()
        val wake = (action as? AutoCachePolicy.Action.Idle)?.wakeAtMs
        val delay = when {
            player.isPlaying || autoCacher.inFlight != null -> TICK_MS
            wake != null -> (wake - System.currentTimeMillis()).coerceIn(1_000, 5 * 60_000)
            else -> return
        }
        handler.postDelayed(tickLoop, delay)
    }

    /** Which queued songs survive a drop, and whether playback is stuck
     *  offline, for the web UI (the plugin mirrors session extras into its
     *  state). Only sent when something changed. */
    private fun publishCacheState() {
        val full = MediaCache.fullyCached(cache)
        val ids = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }.distinct()
            .filter { it in full || offline.audioFileFor(it).exists() }
        val next = Triple(ids, offlinePlayback.stalled, !net.current().online)
        if (next == publishedExtras) return
        publishedExtras = next
        session.setSessionExtras(Bundle().apply {
            putStringArrayList(EXTRA_CACHED_IDS, ArrayList(ids))
            putBoolean(EXTRA_OFFLINE_STALLED, next.second)
            putBoolean(EXTRA_OFFLINE, next.third)
        })
    }

    private fun setAutoCache(enabled: Boolean, onMetered: Boolean) {
        autoCacher.setSettings(enabled, onMetered)
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", enabled).putBoolean("onMetered", onMetered).apply()
        cacheTick()
    }

    private fun cacheStats(): Bundle {
        val sizes = MediaCache.sizes(cache)
        return Bundle().apply {
            putLong("bytes", sizes.values.sum())
            putInt("count", MediaCache.fullyCached(cache).size)
            putLong("cap", MediaCache.CAP_BYTES)
        }
    }

    /** Empties the auto cache (never pinned downloads). The playing song's
     *  entry stays: the player may be reading it. */
    private fun clearCache(): ListenableFuture<SessionResult> {
        autoCacher.cancel()
        val keep = player.currentMediaItem?.mediaId
        val future = com.google.common.util.concurrent.SettableFuture.create<SessionResult>()
        cacheIo.execute {
            MediaCache.clear(cache, keep)
            handler.post {
                cacheTick()
                future.set(SessionResult(SessionResult.RESULT_SUCCESS, cacheStats()))
            }
        }
        return future
    }

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
        handler.removeCallbacks(tickLoop)
        autoCacher.cancel()
        net.stop()
        cacheIo.shutdown()
        // The SimpleCache stays open: it is one per process (MediaCache), and
        // a service started again in this process reuses it.
        overlay.release()
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
                .apply {
                    // Prank sounds and the cache controls: our own app only,
                    // never the car or another controller.
                    if (controller.packageName == packageName) {
                        add(SessionCommand(OverlayEvents.COMMAND_PLAY, Bundle.EMPTY))
                        add(SessionCommand(OverlayEvents.COMMAND_STOP, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_AUTO_CACHE, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_CACHE_STATS, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_CACHE_CLEAR, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_QUEUE_CONTEXT, Bundle.EMPTY))
                    }
                }
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
                OverlayEvents.COMMAND_PLAY -> return playOverlay(session, controller, args)
                OverlayEvents.COMMAND_STOP -> overlay.stop()
                COMMAND_AUTO_CACHE -> {
                    setAutoCache(args.getBoolean("enabled", autoCacher.enabled), args.getBoolean("onMetered", autoCacher.allowMetered))
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS, Bundle().apply {
                        putBoolean("enabled", autoCacher.enabled)
                        putBoolean("onMetered", autoCacher.allowMetered)
                    }))
                }
                COMMAND_CACHE_STATS -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS, cacheStats()))
                COMMAND_CACHE_CLEAR -> return clearCache()
                COMMAND_QUEUE_CONTEXT -> {
                    queueContextType = args.getString("contextType")
                    queueBaseCount = args.getInt("baseCount", 0).coerceAtLeast(0)
                    cacheTick()
                }
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        /** Resolves when the sound is actually heard (or never will be); its
         *  end goes back to the same controller as COMMAND_ENDED. */
        private fun playOverlay(session: MediaSession, controller: MediaSession.ControllerInfo, args: Bundle): ListenableFuture<SessionResult> {
            val future = com.google.common.util.concurrent.SettableFuture.create<SessionResult>()
            overlay.play(
                id = args.getString("id").orEmpty(),
                url = args.getString("url").orEmpty(),
                share = args.getDouble("volume", 1.0),
                duckTo = args.getDouble("duckTo", 1.0),
                maxSec = if (args.containsKey("maxSec")) args.getDouble("maxSec") else null,
                onStarted = { future.set(SessionResult(SessionResult.RESULT_SUCCESS, it)) },
                onEnded = { session.sendCustomCommand(controller, SessionCommand(OverlayEvents.COMMAND_ENDED, Bundle.EMPTY), it) },
            )
            return future
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
            // Our own UI sends the queue's context just before; the car has none.
            if (controller.packageName != packageName) { queueContextType = null; queueBaseCount = 0 }
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
