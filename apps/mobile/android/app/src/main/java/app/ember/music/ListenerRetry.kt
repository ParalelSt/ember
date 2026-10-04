package app.ember.music

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.ResolvingDataSource

/** The listener's own "Tap to retry" on a song that would not load.
 *
 *  The host remembers a song that failed for a passing reason for a couple
 *  of minutes and answers the player's automatic tries from that memory
 *  (the stream route's knownFailureResponse). Retry used to be a plain play,
 *  which reloaded the same address and got the same remembered failure, so
 *  the button could not work for two minutes. A retry now marks the reload
 *  of the failed song (`retry=1`, as the web player's retryStreamUrl does),
 *  and the host makes a real attempt.
 *
 *  The mark is added as the song's stream is opened (dataSourceFactory)
 *  rather than written into the queue, so the queue keeps the plain address
 *  and nothing else carries it: it holds for that song's loads until the
 *  player moves to any song (another one, or the same one again), and only
 *  a retry sets it. */
class ListenerRetry : Player.Listener {
    companion object {
        /** The host's mark (STREAM_RETRY_PARAM in lib/playback/unplayable). */
        const val PARAM = "retry"
        /** Only the host's YouTube stream route knows the mark. */
        private val STREAM_PATH = Regex("/api/youtube/stream/[^/]+$")

        /** [uri] with the retry mark, after any query it already has; any
         *  other address (an upload, a file on the phone) is left as it is. */
        fun marked(uri: Uri): Uri {
            if (uri.scheme != "http" && uri.scheme != "https") return uri
            if (!STREAM_PATH.containsMatchIn(uri.path.orEmpty())) return uri
            if (uri.getQueryParameter(PARAM) == "1") return uri
            return uri.buildUpon().appendQueryParameter(PARAM, "1").build()
        }
    }

    /** The song (its load key, the track id) whose loads carry the mark. */
    @Volatile private var armed: String? = null

    /** The listener tapped retry on [player]. A song that failed reloads,
     *  marked when [mark] (the phone's own player; a cast device fetches the
     *  song itself); anything else is a plain play. */
    fun retry(player: Player, mark: Boolean = true) {
        val failed = player.playerError != null
        if (failed && mark) armed = player.currentMediaItem?.mediaId
        when (player.playbackState) {
            Player.STATE_IDLE -> player.prepare()
            Player.STATE_ENDED -> player.seekToDefaultPosition()
        }
        player.play()
    }

    /** Any move, even to the same song again, is not the retry any more. */
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        armed = null
    }

    fun resolve(spec: DataSpec): DataSpec {
        val id = armed ?: return spec
        return if (spec.key == id) spec.withUri(marked(spec.uri)) else spec
    }

    /** [upstream] with the mark added to the retried song's loads. */
    fun dataSourceFactory(upstream: DataSource.Factory): DataSource.Factory =
        ResolvingDataSource.Factory(upstream) { resolve(it) }
}
