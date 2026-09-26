package app.ember.music

import androidx.media3.common.C
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy

/** How long the player keeps trying to load a song before it reports an
 *  error.
 *
 *  A weak signal (a tunnel, a dead zone) does not make Android drop the
 *  network, so the phone still counts as online while the connection has
 *  given out. ExoPlayer's default gives up after a few seconds of that, and
 *  the error then skipped the song as if it were broken, one song per
 *  outage, five and the music stopped. Here, while online, a connection
 *  failure or timeout is retried with growing waits, inside the player:
 *  the song keeps its place and the player stays "buffering", so the
 *  service keeps its foreground and nothing is skipped. Offline, the same
 *  error is final at once, so the offline rules (OfflinePlayback) move to a
 *  song on the phone without waiting. A 4xx is final too: a song the server
 *  does not have will not appear on a retry. */
class PatientLoadErrors(private val online: () -> Boolean) : DefaultLoadErrorHandlingPolicy(DELAYS_MS.size) {
    companion object {
        /** Waits before each new try, in order; the last repeats. */
        val DELAYS_MS = longArrayOf(2_000, 5_000, 10_000, 20_000, 30_000)
        private val TRANSPORT = setOf(
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        )

        fun isTransport(e: Throwable): Boolean =
            e is HttpDataSource.HttpDataSourceException && e !is HttpDataSource.InvalidResponseCodeException && e.reason in TRANSPORT

        fun isClientError(e: Throwable): Boolean =
            e is HttpDataSource.InvalidResponseCodeException && e.responseCode in 400..499
    }

    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val e = loadErrorInfo.exception
        if (isClientError(e)) return C.TIME_UNSET
        if (isTransport(e)) {
            if (!online()) return C.TIME_UNSET
            return DELAYS_MS[(loadErrorInfo.errorCount - 1).coerceIn(0, DELAYS_MS.lastIndex)]
        }
        return super.getRetryDelayMsFor(loadErrorInfo)
    }
}
