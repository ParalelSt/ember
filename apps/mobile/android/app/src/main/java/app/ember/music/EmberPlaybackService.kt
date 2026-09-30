package app.ember.music

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.webkit.CookieManager
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.ShuffleOrder
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.android.gms.cast.framework.CastContext
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
        /** Volume normalization on or off (`enabled`), the web app's setting. */
        const val COMMAND_NORMALIZE = "ember.normalize"
        /** The equalizer (`enabled`, `bands`: five dB gains), the web app's
         *  setting. Kept on disk, so the car follows it too. */
        const val COMMAND_EQUALIZER = "ember.equalizer"
        /** The audio output the app's picker pinned (`deviceId`: an
         *  AudioDeviceInfo id, -1 for Android's own routing). */
        const val COMMAND_OUTPUT = "ember.output"
        /** Session extras the plugin mirrors into its state. */
        const val EXTRA_CACHED_IDS = "cachedIds"
        const val EXTRA_OFFLINE_STALLED = "offlineStalled"
        const val EXTRA_OFFLINE = "offline"
        /** The pinned output's AudioDeviceInfo id, -1 for none (automatic). */
        const val EXTRA_OUTPUT_PREFERRED = "outputPreferredId"
        /** Whether the queue is shuffled (QueueShuffle): the car's button or
         *  the app's. The ExoPlayer's flag says the same, but a cast device
         *  has none. */
        const val EXTRA_SHUFFLE = "shuffle"
        /** The app's own shuffle button (`on`, and `order`: the song ids from
         *  before, when it turned shuffle on). The app has reordered its
         *  queue itself; this only keeps the flag and the way back. */
        const val COMMAND_SHUFFLE_STATE = "ember.shuffleState"
        /** Apps that are the car: the heart button needs to know which songs
         *  are liked once one of them connects. */
        val CAR_PACKAGES = setOf(
            "com.google.android.projection.gearhead",
            "com.google.android.autosimulator",
            "com.android.car.media",
            "com.google.android.carassistant",
        )
        /** How long a service started for a media button (the app was
         *  closed) may take to show its notification before it gives up
         *  cleanly. Android allows 5 s (10 s on 12+). */
        const val MEDIA_BUTTON_GUARD_MS = 3_500L
        private const val GUARD_CHANNEL = "ember.resume"
        private const val GUARD_NOTIFICATION_ID = 7201
        private const val LIKES_MAX_AGE_MS = 5 * 60_000L
        private const val PREFS = "ember.autoCache"
        private const val NORMALIZE_PREFS = "ember.normalize"
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
         *  or the downloaded copy when there is one (OfflineAudio), through
         *  the equalizer [eq] when given (Equalizer.kt). Its own function so
         *  tests build the same one. */
        fun buildPlayer(
            context: Context,
            streams: DataSource.Factory,
            offline: OfflineStore,
            eq: AudioProcessor? = null,
            online: () -> Boolean = { true },
        ): ExoPlayer =
            (if (eq != null) ExoPlayer.Builder(context, EqualizerProcessor.renderers(context, eq)) else ExoPlayer.Builder(context))
                .setMediaSourceFactory(
                    DefaultMediaSourceFactory(context)
                        .setDataSourceFactory(OfflineAudio.dataSourceFactory(context, streams, offline))
                        .setLoadErrorHandlingPolicy(PatientLoadErrors(online)),
                )
                .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                // Screen off, Android lets the CPU and Wi-Fi sleep; the audio
                // output alone does not keep the stream's download going,
                // and the song ran dry mid-way. Held only while it plays.
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build()
                // Shuffle reorders the queue itself (QueueShuffle), so the
                // shuffle flag must never change the play order as well.
                .also { it.setShuffleOrder(ShuffleOrder.UnshuffledShuffleOrder(0)) }
    }

    private lateinit var player: ExoPlayer
    private lateinit var normalizer: Normalizer
    /** The session's player when nothing is cast: the ExoPlayer at the
     *  person's level times the song's gain. */
    private lateinit var levelPlayer: LevelPlayer
    /** Casting (CastSupport.kt): null on a phone without Google Play
     *  services, where there is nothing to cast with. */
    private var castPlayer: CastPlayer? = null
    private var castSwitch: CastSwitch? = null
    /** Signing cast links: a network call, never behind a slow browse list. */
    private val castIo = Executors.newSingleThreadExecutor()
    /** The player that plays now: the phone's, or the cast device's. */
    private val active: Player get() = castSwitch?.active ?: player
    /** A quiet song's boost past full volume (LoudnessBooster). */
    private lateinit var booster: LoudnessBooster
    /** The equalizer in the player's audio sink; its settings live on disk. */
    private val equalizer = EqualizerProcessor()
    private lateinit var savedQueue: SavedQueue
    private lateinit var session: MediaLibrarySession
    lateinit var api: ServerApi
    private lateinit var tree: BrowseTree
    /** Covers on the Ember server go to the car as content URIs (ArtworkProvider). */
    private val artAuthority: String by lazy { ArtworkUris.authority(packageName) }
    private val shuffle = ShuffleState()
    private val liked = LikedSongs()
    @Volatile private var likesLoading = false
    /** The last custom layout sent: only a change is sent again. */
    private var lastButtons: Triple<Boolean?, Boolean, Int>? = null
    /** Root tabs the car last asked for (EXTRAS_KEY_ROOT_CHILDREN_LIMIT). */
    @Volatile private var rootLimit = 0
    /** A headset's or a car's single play/pause button: 1, 2 or 3 presses. */
    private val presses by lazy {
        PressCounter(later = { ms, fn ->
            val r = Runnable(fn)
            handler.postDelayed(r, ms)
            ({ handler.removeCallbacks(r) })
        }) { runKey(it) }
    }
    private lateinit var overlay: PrankOverlay
    private val io = Executors.newSingleThreadExecutor()
    /** Loading the saved queue (a local file): never behind a slow browse
     *  list or the liked songs on `io`, since a play key with the app closed
     *  has seconds to show its notification. */
    private val resumeIo = Executors.newSingleThreadExecutor()
    /** Set in onCreate, cleared by the first start command: a media button
     *  that is the reason the service exists (the app was closed). */
    private var firstStart = true
    @Volatile private var likesLoadedAt = 0L
    /** Loudness lookups, apart from `io`: a slow browse list must not hold
     *  back the next song's level (and the other way round). */
    private val gainIo = Executors.newSingleThreadExecutor()
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
    /** The output the app's picker pinned (AudioOutputs.kt). */
    private val output = OutputPreference(route = ::routeTo, publish = ::publishExtras)
    private val audioManager: AudioManager? get() = getSystemService(AUDIO_SERVICE) as AudioManager?

    override fun onCreate() {
        super.onCreate()
        val baseUrl = ServerConfig.baseUrl(this)
        api = ServerApi(baseUrl) { CookieManager.getInstance().getCookie(baseUrl) }
        // Read at call time: offline and net are set up just below.
        tree = BrowseTree(
            api, artAuthority,
            downloads = ::downloadedTracks,
            downloadedArt = { offline.artFileFor(it).exists() },
            online = { !::net.isInitialized || net.current().online },
            onLiked = { ids -> handler.post { liked.replace(ids); refreshButtons() } },
        )
        // Streams go through the same OkHttp client, so they carry the cookie
        // and get the same 401 retry as the JSON calls.
        val dataSource = OkHttpDataSource.Factory(api.http)
        cache = MediaCache.shared(this)
        offline = OfflineStore.shared(this)
        val streams = MediaCache.dataSourceFactory(cache, dataSource)
        // Asked live on each failed load; the network watch starts just below.
        equalizer.settings = EqSettings.load(EqSettings.prefs(this))
        player = buildPlayer(this, streams, offline, equalizer) { !::net.isInitialized || net.current().online }
        player.addListener(QueueListener(
            player,
            recordPlay = ::recordPlay,
            extendQueue = ::maybeExtendQueue,
            // Read at call time: offlinePlayback is set up in startAutoCache below.
            offlineHandles = { offlinePlayback.handles(it) },
            offlineSkips = { offlinePlayback.skips(it) },
            onUnplayable = UnplayableNotices::record,
            extendAfterFailure = ::extendAfterFailure,
        ))
        savedQueue = SavedQueue(java.io.File(filesDir, SavedQueue.FILE_NAME))
        player.addListener(savedQueue.Saver(player, io))
        overlay = PrankOverlay(this, player, dataSource, baseUrl)
        booster = LoudnessBooster(player)
        normalizer = Normalizer(
            player, GainStore(getSharedPreferences(NORMALIZE_PREFS, MODE_PRIVATE)), api::trackGain, gainIo,
            main = { handler.post(it) },
            booster = booster,
            delay = { ms, r -> handler.postDelayed(r, ms) },
        )
        normalizer.setEnabled(getSharedPreferences(NORMALIZE_PREFS, MODE_PRIVATE).getBoolean("enabled", true))
        // The session (the app, the notification, the car) sets the person's
        // level; the player underneath adds the song's gain (Normalizer).
        levelPlayer = LevelPlayer(player, normalizer) { on -> setShuffle(on) }
        session = MediaLibrarySession.Builder(this, levelPlayer, Callback())
            // Covers on the Ember server need the cookie; others must not get it.
            .setBitmapLoader(ArtworkSources.bitmapLoader(this, baseUrl, dataSource, OkHttpDataSource.Factory(okhttp3.OkHttpClient())))
            .build()
        startAutoCache(streams)
        startCasting(baseUrl)
        watchOutputs()
        // Like, shuffle and repeat as buttons on the now-playing screen (car +
        // notification), each showing its state.
        player.addListener(buttonWatch)
        refreshButtons()
    }

    /** Keeps the buttons' state with the player's (the phone's or the TV's). */
    private val buttonWatch = object : Player.Listener {
        override fun onRepeatModeChanged(repeatMode: Int) = refreshButtons()
        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = refreshButtons()
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = refreshButtons()
    }

    private fun refreshButtons() {
        if (!::session.isInitialized) return
        val p = active
        val state = Triple(liked.isLiked(p.currentMediaItem?.mediaId), shuffle.on, p.repeatMode)
        if (state == lastButtons) return
        lastButtons = state
        session.setCustomLayout(ImmutableList.copyOf(CarButtons.layout(state.first, state.second, state.third)))
    }

    /** The songs downloaded to the phone, by title, for the car's lists. */
    private fun downloadedTracks(): List<org.json.JSONObject> =
        offline.trackFiles().keys.mapNotNull { offline.track(it) }.sortedBy { it.optString("title").lowercase() }

    // ── Shuffle ─────────────────────────────────────────────────────────

    /** Shuffle from the car, the notification or a head unit (and off from
     *  the app): the songs still to come are reordered (QueueShuffle), and
     *  off puts the order back. The flag goes out first, so the app hears "shuffle on" before
     *  the reordered queue arrives (its way back is the queue it has then). */
    private fun setShuffle(on: Boolean) {
        val p = active
        val items = (0 until p.mediaItemCount).map { p.getMediaItemAt(it) }
        val ids = items.map { it.mediaId }
        val index = p.currentMediaItemIndex
        val original = shuffle.original
        if (on) shuffle.shuffled(ids) else shuffle.clear()
        shuffleFlag(on)
        if (items.isEmpty() || index == C.INDEX_UNSET) return
        if (on && items.size > 1) {
            QueueSync.apply(p, QueueShuffle.shuffledOrder(items.size, index).map { items[it] }, index)
        } else if (!on && original != null) {
            val (order, at) = QueueShuffle.restoredOrder(original, ids, index)
            QueueSync.apply(p, order.map { items[it] }, at)
        }
        Log.i(TAG, "shuffle ${if (on) "on" else "off"} (${items.size} songs)")
    }

    private fun shuffleFlag(on: Boolean) {
        if (player.shuffleModeEnabled != on) player.shuffleModeEnabled = on
        publishExtras()
        refreshButtons()
    }

    // ── Liked songs (the car's heart button) ────────────────────────────

    /** The liked songs for the heart button: when the car connects, again
     *  if the last look is older than [LIKES_MAX_AGE_MS] (the phone app may
     *  have liked songs since). */
    private fun loadLikes() {
        if (likesLoading) return
        if (liked.known() && System.currentTimeMillis() - likesLoadedAt < LIKES_MAX_AGE_MS) return
        likesLoading = true
        io.execute {
            runCatching { api.likes().map { it.optString("id") } }
                .onSuccess { ids -> likesLoadedAt = System.currentTimeMillis(); handler.post { liked.replace(ids); refreshButtons() } }
                .onFailure { Log.w(TAG, "likes: ${it.message}") }
            likesLoading = false
        }
    }

    private fun toggleLike(): SessionResult {
        val item = active.currentMediaItem ?: return SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE)
        val track = TrackItems.trackOf(item) ?: return SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE)
        val id = item.mediaId
        val was = liked.isLiked(id) ?: return SessionResult(SessionResult.RESULT_ERROR_INVALID_STATE)
        liked.set(id, !was)
        refreshButtons()
        io.execute {
            runCatching { if (was) api.unlike(id) else api.like(track) }
                .onSuccess { Log.i(TAG, "${if (was) "unliked" else "liked"} ${track.optString("title")} from the car") }
                .onFailure {
                    Log.w(TAG, "like: ${it.message}")
                    handler.post { liked.set(id, was); refreshButtons() }
                }
        }
        return SessionResult(SessionResult.RESULT_SUCCESS)
    }

    // ── Media buttons (MediaKeys) ───────────────────────────────────────

    /** One media key's action on the session's player (the phone's or the
     *  TV's). Play with nothing loaded resumes the saved queue. */
    private fun runKey(action: MediaKeys.Action) {
        val p = session.player
        Log.i(TAG, "media key: $action")
        when (action) {
            MediaKeys.Action.TOGGLE ->
                if (p.mediaItemCount == 0) resumeAndPlay() else androidx.media3.common.util.Util.handlePlayPauseButtonAction(p)
            MediaKeys.Action.PLAY ->
                if (p.mediaItemCount == 0) resumeAndPlay() else androidx.media3.common.util.Util.handlePlayButtonAction(p)
            MediaKeys.Action.PAUSE -> p.pause()
            MediaKeys.Action.NEXT -> if (p.mediaItemCount > 0) p.seekToNext()
            MediaKeys.Action.PREVIOUS -> if (p.mediaItemCount > 0) p.seekToPrevious()
            MediaKeys.Action.FORWARD -> if (p.mediaItemCount > 0) p.seekForward()
            MediaKeys.Action.BACK -> if (p.mediaItemCount > 0) p.seekBack()
        }
    }

    /** The saved queue (SavedQueue), where it was, playing. Nothing saved:
     *  nothing to play (the foreground guard then lets the service go). */
    private fun resumeAndPlay() {
        resumeIo.execute {
            val saved = runCatching { savedQueue.resume(api.baseUrl, artAuthority) }.getOrNull()
            handler.post {
                val p = session.player
                if (p.mediaItemCount > 0) { androidx.media3.common.util.Util.handlePlayButtonAction(p); return@post }
                if (saved == null) { Log.i(TAG, "play with nothing saved: nothing to resume"); return@post }
                Log.i(TAG, "resume ${saved.mediaItems.size} song(s) at ${saved.startIndex} for a media button")
                shuffle.clear()
                shuffleFlag(false)
                p.setMediaItems(saved.mediaItems, saved.startIndex, saved.startPositionMs)
                p.prepare()
                p.play()
            }
        }
    }

    /** Started for a media button with the app closed (EmberMediaButtonReceiver):
     *  Android requires the notification within seconds. Media3 shows it as
     *  soon as the resumed queue plays; if nothing does (the saved queue
     *  would not load), the service shows a quiet one of its own for a
     *  moment and lets go, instead of being killed for it. */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val result = super.onStartCommand(intent, flags, startId)
        // Only the start the service was created for: the notification's
        // own buttons are media button starts too, of a running service.
        val first = firstStart
        firstStart = false
        if (first && intent?.action == Intent.ACTION_MEDIA_BUTTON) {
            handler.removeCallbacks(foregroundGuard)
            handler.postDelayed(foregroundGuard, MEDIA_BUTTON_GUARD_MS)
        }
        return result
    }

    private val foregroundGuard = Runnable { guardForeground() }

    private fun guardForeground() {
        val p = session.player
        val inForeground = android.os.Build.VERSION.SDK_INT >= 29 && foregroundServiceType != 0
        val playing = p.mediaItemCount > 0 && p.playWhenReady &&
            (p.playbackState == Player.STATE_READY || p.playbackState == Player.STATE_BUFFERING)
        if (inForeground || (playing && android.os.Build.VERSION.SDK_INT < 29)) return
        Log.w(TAG, "media button start: nothing in the foreground yet (items=${p.mediaItemCount}, playing=$playing); settling it")
        runCatching {
            val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            if (android.os.Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(GUARD_CHANNEL) == null) {
                nm.createNotificationChannel(android.app.NotificationChannel(GUARD_CHANNEL, "Resuming music", android.app.NotificationManager.IMPORTANCE_LOW))
            }
            val n = androidx.core.app.NotificationCompat.Builder(this, GUARD_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Ember")
                .setSilent(true)
                .build()
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                startForeground(GUARD_NOTIFICATION_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(GUARD_NOTIFICATION_ID, n)
            }
            if (android.os.Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        }.onFailure { Log.w(TAG, "foreground guard: ${it.message}") }
        if (p.mediaItemCount == 0) stopSelf()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    private fun recordPlay(track: org.json.JSONObject) {
        io.execute { runCatching { api.recordPlay(track) }.onFailure { Log.w(TAG, "history: ${it.message}") } }
    }

    // ── Casting ─────────────────────────────────────────────────────────

    /** Chromecast, Google speakers, Android TV. When a Cast session starts
     *  (the app's Cast button, or the system's output switcher), the queue
     *  moves to a CastPlayer and the session follows it, so the app, the
     *  notification and the lock screen control the TV. The equalizer and
     *  volume normalization live in the ExoPlayer and do not apply there. */
    private fun startCasting(baseUrl: String) {
        // The Task-based getSharedInstance needs an executor and a callback for
        // what is, on the main thread, an immediate answer.
        @Suppress("DEPRECATION")
        val ctx = runCatching { CastContext.getSharedInstance(this) }
            .onFailure { Log.i(TAG, "no Cast on this phone: ${it.message}") }
            .getOrNull() ?: return
        val cast = runCatching { CastPlayer(ctx, CastConverter()) }
            .onFailure { Log.w(TAG, "cast player: ${it.message}") }
            .getOrNull() ?: return
        val signer = CastSigner({ ids -> api.castLinks(ids) })
        val queue = CastQueuePlayer(cast, signer, baseUrl, castIo) { handler.post(it) }
        // History and radio go on while the TV plays; a song the TV cannot
        // play is skipped, as on the phone.
        queue.addListener(QueueListener(queue, recordPlay = ::recordPlay, extendQueue = ::maybeExtendQueue, onUnplayable = UnplayableNotices::record))
        queue.addListener(buttonWatch)
        val switch = CastSwitch(
            player, queue, baseUrl,
            whenApplied = queue::afterPending,
            later = { ms, fn -> handler.postDelayed(fn, ms) },
            // The TV plays the file as it is: no boost on the phone's stopped
            // player while it does, and the boost back on the phone's audio
            // session once the music is.
            onCasting = booster::setSuspended,
        ) { p ->
            session.player = if (p === queue) queue else levelPlayer
            refreshButtons()
        }
        cast.setSessionAvailabilityListener(object : SessionAvailabilityListener {
            override fun onCastSessionAvailable() {
                Log.i(TAG, "cast session started: the queue moves to the TV")
                switch.toRemote()
            }
            override fun onCastSessionUnavailable() {
                Log.i(TAG, "cast session ended: the queue comes back to the phone")
                switch.toLocal()
                signer.clear()
            }
        })
        castPlayer = cast
        castSwitch = switch
        // A session already running (the service started again mid-cast).
        if (cast.isCastSessionAvailable) switch.adoptRemote()
    }

    // ── Audio output ────────────────────────────────────────────────────

    /** Points the phone's player at the output with [id] (the app's picker),
     *  or back at Android's own routing for null. Only the ExoPlayer: the
     *  cast device plays on its own, and the level and cast players wrap
     *  this one. The audio session id stays the same, so the equalizer, the
     *  loudness booster and normalization carry on. False when no output
     *  with that id is connected. */
    private fun routeTo(id: Int?): Boolean {
        val device = if (id == null) null else {
            val devices = runCatching { audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) }.getOrNull()
            devices?.firstOrNull { it.id == id } ?: return false
        }
        return runCatching { player.setPreferredAudioDevice(device) }
            .onFailure { Log.w(TAG, "output: ${it.message}") }
            .isSuccess
    }

    /** A pinned output that is unplugged or disconnected lets go, so the
     *  music follows Android's routing again (and a device that comes back
     *  gets a new id, so it could not be pinned again anyway). */
    private val deviceWatch = object : AudioDeviceCallback() {
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
            output.onRemoved(removedDevices.orEmpty().map { it.id })
        }
    }

    private fun watchOutputs() {
        runCatching { audioManager?.registerAudioDeviceCallback(deviceWatch, handler) }
            .onFailure { Log.w(TAG, "output watch: ${it.message}") }
    }

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
            // A prefetch the host answered 410: the song is gone before the
            // player gets to it. The app greys it in its queue (no message:
            // nothing has been skipped yet).
            onGone = { id, error -> UnplayableNotices.record(Unplayable.notice(id, titleInQueue(id), error, Unplayable.FLAGGED)) },
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
        publishExtras()
    }

    /** All the session extras at once: setSessionExtras replaces the lot, so
     *  the cache state and the pinned output always go together. */
    private fun publishExtras() {
        if (!::session.isInitialized) return
        val cacheState = publishedExtras
        session.setSessionExtras(Bundle().apply {
            if (cacheState != null) {
                putStringArrayList(EXTRA_CACHED_IDS, ArrayList(cacheState.first))
                putBoolean(EXTRA_OFFLINE_STALLED, cacheState.second)
                putBoolean(EXTRA_OFFLINE, cacheState.third)
            }
            putInt(EXTRA_OUTPUT_PREFERRED, output.extra)
            putBoolean(EXTRA_SHUFFLE, shuffle.on)
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
        // The phone's player, or the TV's while casting.
        val player = active
        if (player.repeatMode != Player.REPEAT_MODE_OFF) return
        if (player.currentMediaItemIndex != player.mediaItemCount - 1) return
        val current = player.currentMediaItem?.let { TrackItems.trackOf(it) } ?: return
        if (current.optString("source") != "youtube") return
        fetchRadio(player, current) {}
    }

    /** The last song would not play (YouTube no longer has it): radio looks
     *  for what comes next, seeded by the song before it (a dead video makes
     *  a poor seed), and the listener moves on to what it finds. */
    private fun extendAfterFailure(done: (Boolean) -> Unit): Boolean {
        val player = active
        if (player.repeatMode != Player.REPEAT_MODE_OFF) return false
        if (player.currentMediaItemIndex != player.mediaItemCount - 1) return false
        val tracks = (0 until player.mediaItemCount).mapNotNull { TrackItems.trackOf(player.getMediaItemAt(it)) }
        val seed = tracks.dropLast(1).lastOrNull { it.optString("source") == "youtube" }
            ?: tracks.lastOrNull()?.takeIf { it.optString("source") == "youtube" }
            ?: return false
        fetchRadio(player, seed, done)
        return true
    }

    /** Recommendations seeded by [seed], minus anything already queued,
     *  appended; [done] hears on the main thread whether any were. The host
     *  leaves out songs it knows will not play. */
    private fun fetchRadio(player: Player, seed: org.json.JSONObject, done: (Boolean) -> Unit) {
        val queued = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }.toSet()
        io.execute {
            val more = runCatching { api.recommended(seed.optString("sourceId")) }
                .getOrElse { Log.w(TAG, "radio: ${it.message}"); emptyList() }
                .filter { it.optString("id") !in queued && it.optString("unavailableAt").isEmpty() }
                .take(20)
                .map { TrackItems.toMediaItem(it, api.baseUrl, artAuthority) }
            Log.i(TAG, "radio after ${seed.optString("title")}: +${more.size}")
            android.os.Handler(mainLooper).post {
                if (more.isNotEmpty()) player.addMediaItems(more)
                done(more.isNotEmpty())
            }
        }
    }

    /** A queued song's title, for a message about it. */
    private fun titleInQueue(id: String): String {
        val player = active
        for (i in 0 until player.mediaItemCount) {
            val item = player.getMediaItemAt(i)
            if (item.mediaId == id) return item.mediaMetadata.title?.toString().orEmpty()
        }
        return ""
    }

    /** Run a browse fetch off the main thread and turn it into a LibraryResult.
     *  The car shows whatever list comes back, so failures become one-line
     *  items rather than an empty screen with no explanation. */
    private fun onIo(page: Int = 0, pageSize: Int = Int.MAX_VALUE, fn: () -> List<MediaItem>): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val future = com.google.common.util.concurrent.SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
        io.execute {
            val items: List<MediaItem> = try {
                // Offline, the lists are the downloads, which need no sign-in.
                val online = !::net.isInitialized || net.current().online
                if (online && CookieManager.getInstance().getCookie(api.baseUrl).isNullOrBlank()) listOf(tree.placeholder("Sign in to Ember on your phone"))
                else fn()
            } catch (e: Exception) {
                Log.w(TAG, "browse: ${e.message}")
                listOf(tree.placeholder(BrowseTree.failureText(e)))
            }
            future.set(LibraryResult.ofItemList(ImmutableList.copyOf(BrowseTree.page(items, page, pageSize)), null))
        }
        return future
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiped away from recents while paused: nothing to keep alive.
        val p = active
        if (!p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(tickLoop)
        handler.removeCallbacks(foregroundGuard)
        runCatching { audioManager?.unregisterAudioDeviceCallback(deviceWatch) }
        autoCacher.cancel()
        net.stop()
        cacheIo.shutdown()
        // The SimpleCache stays open: it is one per process (MediaCache), and
        // a service started again in this process reuses it.
        overlay.release()
        normalizer.release()
        booster.release()
        session.release()
        castPlayer?.setSessionAvailabilityListener(null)
        castPlayer?.release()
        castIo.shutdown()
        player.release()
        io.shutdown()
        resumeIo.shutdown()
        gainIo.shutdown()
        super.onDestroy()
    }

    /** Who may connect: see ControllerPolicy (security audit 2026-09-25, M4). */
    private val gate by lazy { ControllerGate(this) }
    private fun allowed(controller: MediaSession.ControllerInfo): ControllerPolicy.Verdict =
        gate.verdict(controller.packageName, controller.uid, controller.isTrusted)

    inner class Callback : MediaLibrarySession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val verdict = allowed(controller)
            Log.i(TAG, "connect from ${controller.packageName} uid=${controller.uid} (legacy=${controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION}) -> $verdict")
            // Any app on the phone can bind to an exported service; only the
            // system, the car, the Assistant and Ember itself get in.
            if (!verdict.allowed) return MediaSession.ConnectionResult.reject()
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(SessionCommand(COMMAND_SHUFFLE, Bundle.EMPTY))
                .add(SessionCommand(COMMAND_REPEAT, Bundle.EMPTY))
                .add(SessionCommand(CarButtons.COMMAND_LIKE, Bundle.EMPTY))
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
                        add(SessionCommand(COMMAND_NORMALIZE, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_EQUALIZER, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_OUTPUT, Bundle.EMPTY))
                        add(SessionCommand(COMMAND_SHUFFLE_STATE, Bundle.EMPTY))
                    }
                }
                .build()
            // The car: its heart button needs the liked songs.
            if (controller.packageName in CAR_PACKAGES) loadLikes()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build()
        }

        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            val player = active
            when (command.customAction) {
                COMMAND_SHUFFLE -> setShuffle(!shuffle.on)
                COMMAND_REPEAT -> player.repeatMode = CarButtons.nextRepeat(player.repeatMode)
                CarButtons.COMMAND_LIKE -> return Futures.immediateFuture(toggleLike())
                COMMAND_SHUFFLE_STATE -> {
                    when {
                        args.getBoolean("on", false) -> {
                            shuffle.setByApp(true, args.getStringArrayList("order"))
                            shuffleFlag(true)
                        }
                        // A page that never had the order (the car shuffled
                        // while it was closed) asks native to put it back.
                        args.getBoolean("restore", false) -> setShuffle(false)
                        // The app put its queue back itself, or moved on to
                        // another list: the old order must not touch it.
                        else -> { shuffle.clear(); shuffleFlag(false) }
                    }
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
                COMMAND_NORMALIZE -> {
                    val on = args.getBoolean("enabled", true)
                    getSharedPreferences(NORMALIZE_PREFS, MODE_PRIVATE).edit().putBoolean("enabled", on).apply()
                    normalizer.setEnabled(on)
                }
                COMMAND_EQUALIZER -> {
                    val eq = EqSettings.fromBundle(args)
                    EqSettings.save(EqSettings.prefs(this@EmberPlaybackService), eq)
                    equalizer.settings = eq
                }
                COMMAND_OUTPUT -> {
                    // Answers with the pin as it now stands, so the app's
                    // picker does not wait for the session extras.
                    val ok = output.set(args.getInt("deviceId", -1))
                    val extras = Bundle().apply { putInt(EXTRA_OUTPUT_PREFERRED, output.extra) }
                    return Futures.immediateFuture(
                        if (ok) SessionResult(SessionResult.RESULT_SUCCESS, extras) else SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE, extras),
                    )
                }
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

        /** Every media key (MediaKeys): a headset, the steering wheel, a car
         *  over Bluetooth, a mirroring app. The one play/pause button counts
         *  presses (1 play/pause, 2 next, 3 previous), except from Ember's own
         *  notification, whose buttons are one tap each. */
        override fun onMediaButtonEvent(session: MediaSession, controllerInfo: MediaSession.ControllerInfo, intent: Intent): Boolean {
            @Suppress("DEPRECATION")
            val raw = intent.getParcelableExtra<android.view.KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
            val action = MediaKeys.actionFor(raw.keyCode) ?: return false
            val key = MediaKeys.pressOf(intent)
            if (key == null) {
                // A held key repeats: seeking keeps going, anything else once.
                if (action == MediaKeys.Action.FORWARD || action == MediaKeys.Action.BACK) runKey(action)
                return true
            }
            val tv = packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
            if (MediaKeys.counts(key.keyCode) && !tv && !session.isMediaNotificationController(controllerInfo)) {
                presses.press()
                return true
            }
            presses.flush()
            runKey(action)
            return true
        }

        /** Play with nothing loaded: Android had closed the app, and the car,
         *  a headset or the steering wheel wants the music back. The last
         *  queue picks up where it was (SavedQueue); with none saved, play
         *  does nothing, as before. */
        override fun onPlaybackResumption(mediaSession: MediaSession, controller: MediaSession.ControllerInfo): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val future = com.google.common.util.concurrent.SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            resumeIo.execute {
                val saved = runCatching { savedQueue.resume(api.baseUrl, artAuthority) }.getOrNull()
                Log.i(TAG, "resume for ${controller.packageName}: ${saved?.mediaItems?.size ?: 0} item(s)")
                if (saved != null) future.set(saved) else future.setException(UnsupportedOperationException("no saved queue"))
            }
            return future
        }

        /** A controller (the car, or a plugin call) may hand over items that
         *  carry only a mediaId. Rebuild the playable item from the JSON that
         *  rides in the extras, or drop what we cannot resolve. */
        override fun onAddMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, items: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(items.mapNotNull(::resolve).toMutableList())

        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
            Log.i(TAG, "root for ${browser.packageName} recent=${params?.isRecent} suggested=${params?.isSuggested}")
            // onConnect already refused strangers; the library is the part
            // worth a second look, so check again before handing out the root.
            if (!allowed(browser).allowed) return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED))
            // How many tabs the car shows (Android Auto: 4).
            rootLimit = params?.extras?.getInt(androidx.media3.session.MediaConstants.EXTRAS_KEY_ROOT_CHILDREN_LIMIT, 0) ?: 0
            // Lists by default, a grid for playlists (per folder), and the
            // car may search.
            val rootParams = LibraryParams.Builder()
                .setOffline(params?.isOffline ?: false)
                .setRecent(params?.isRecent ?: false)
                .setSuggested(params?.isSuggested ?: false)
                .setExtras(BrowseTree.rootExtras())
                .build()
            return Futures.immediateFuture(LibraryResult.ofItem(tree.root(), rootParams))
        }
        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            Log.i(TAG, "children of $parentId (page $page of $pageSize) for ${browser.packageName}")
            return onIo(page, pageSize) { tree.children(parentId, rootLimit) }
        }
        /** A song or list the car has been shown, by id (a voice request or
         *  the car reopening where it was). */
        override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> {
            val track = tree.trackById(mediaId)
                ?: return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
            return Futures.immediateFuture(LibraryResult.ofItem(TrackItems.toMediaItem(track, api.baseUrl, artAuthority).buildUpon().setMediaId(mediaId).build(), null))
        }
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
            return onIo(page, pageSize) { tree.search(query) }
        }
        /** The car tapped a track inside a list. A legacy browser sends ONE item
         *  with only its id, so play the rest of the list it was shown in too;
         *  the web app sends the whole queue with the track JSON attached. */
        override fun onSetMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, items: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val mine = controller.packageName == packageName
            // Our own UI sends the queue's context just before; the car has
            // none. A list from the car is not shuffled either (the app's own
            // shuffle comes with its queue, COMMAND_SHUFFLE_STATE).
            if (!mine) {
                queueContextType = null; queueBaseCount = 0
                if (shuffle.on) { shuffle.clear(); shuffleFlag(false) }
            }
            val query = items.singleOrNull()?.requestMetadata?.searchQuery
            if (!mine && query != null) return voiceSearch(query, controller)
            val resolved: List<MediaItem> =
                if (items.size == 1 && items[0].localConfiguration == null && TrackItems.trackOf(items[0]) == null)
                    tree.queueFor(items[0].mediaId).map { TrackItems.toMediaItem(it, api.baseUrl, artAuthority) }
                else items.mapNotNull(::resolve)
            Log.i(TAG, "set ${items.size} item(s) from ${controller.packageName} -> queue of ${resolved.size}")
            return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(resolved, startIndex.coerceIn(0, maxOf(0, resolved.size - 1)), startPositionMs))
        }

        /** "Play <song> on Ember" (the Assistant, the car's voice button):
         *  the search's songs, best match first. No words at all ("play
         *  music on Ember") resumes the saved queue. */
        private fun voiceSearch(query: String, controller: MediaSession.ControllerInfo): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val future = com.google.common.util.concurrent.SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            io.execute {
                val result = runCatching {
                    if (query.isBlank()) savedQueue.resume(api.baseUrl, artAuthority)
                    else api.search(query).take(50).map { TrackItems.toMediaItem(it, api.baseUrl, artAuthority) }
                        .takeIf { it.isNotEmpty() }?.let { MediaSession.MediaItemsWithStartPosition(it, 0, C.TIME_UNSET) }
                }.onFailure { Log.w(TAG, "voice search: ${it.message}") }.getOrNull()
                Log.i(TAG, "voice \"$query\" from ${controller.packageName} -> ${result?.mediaItems?.size ?: 0} song(s)")
                if (result != null) future.set(result) else future.setException(UnsupportedOperationException("nothing found"))
            }
            return future
        }

        /** Playable item for whatever a controller handed us: already complete,
         *  carrying its track JSON, or just an id the car has seen before. */
        private fun resolve(item: MediaItem): MediaItem? {
            if (item.localConfiguration != null) return item
            val json = TrackItems.trackOf(item) ?: tree.trackById(item.mediaId) ?: return null
            return TrackItems.toMediaItem(json, api.baseUrl, artAuthority)
        }
    }
}
