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
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate() {
        super.onCreate()
        val baseUrl = ServerConfig.baseUrl(this)
        api = ServerApi(baseUrl) { CookieManager.getInstance().getCookie(baseUrl) }
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
            }
        })
        session = MediaLibrarySession.Builder(this, player, Callback()).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

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
        override fun onAddMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, items: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> {
            val resolved = items.mapNotNull { item ->
                if (item.localConfiguration != null) item
                else TrackItems.trackOf(item)?.let { TrackItems.toMediaItem(it, api.baseUrl) }
            }.toMutableList()
            return Futures.immediateFuture(resolved)
        }

        // Browse tree arrives in Task 4.
        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_NOT_SUPPORTED))
    }
}
