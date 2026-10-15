package app.ember.music

import androidx.media3.common.C
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy

/** How long the player keeps trying to load a song before it reports an
 *  error.
 *
 *  A connection failure or timeout is the connection, not the song. It is
 *  retried with growing waits, inside the player, for about ten minutes:
 *  the song keeps its place and the player stays "buffering", so the
 *  service keeps its foreground and the song goes on by itself when the
 *  connection comes back. Online or offline alike: whether to move on to a
 *  song that is on the phone instead is the offline rules' call
 *  (OfflinePlayback), which they make from what the player is doing, not
 *  from an error. Before, offline made the error final at once, and the
 *  player then sat stopped, idle, until someone pressed play.
 *
 *  A 4xx is final at once: a song the server does not have will not appear
 *  on a retry. Anything else keeps ExoPlayer's own short retries and is
 *  final after [OTHER_TRIES] of them, as before. */
class PatientLoadErrors : DefaultLoadErrorHandlingPolicy() {
    companion object {
        /** Waits before each new try, in order; the last repeats. */
        val DELAYS_MS = longArrayOf(2_000, 5_000, 10_000, 20_000, 30_000)
        /** Connection failures in a row before the error is final: about ten
         *  minutes of waits (2+5+10+20 s, then 30 s each). */
        const val TRANSPORT_TRIES = 24
        /** Other failures in a row before the error is final (ExoPlayer's
         *  own count). */
        const val OTHER_TRIES = 5
        private val TRANSPORT = setOf(
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        )

        fun isTransport(e: Throwable): Boolean =
            e is HttpDataSource.HttpDataSourceException && e !is HttpDataSource.InvalidResponseCodeException && e.reason in TRANSPORT

        fun isClientError(e: Throwable): Boolean =
            e is HttpDataSource.InvalidResponseCodeException && e.responseCode in 400..499
    }

    /** Every limit is set in [getRetryDelayMsFor], so the count that would
     *  make the loader report an error that is still being retried never
     *  comes. */
    override fun getMinimumLoadableRetryCount(dataType: Int): Int = Int.MAX_VALUE

    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val e = loadErrorInfo.exception
        val count = loadErrorInfo.errorCount
        if (isClientError(e)) return C.TIME_UNSET
        if (isTransport(e)) {
            if (count > TRANSPORT_TRIES) return C.TIME_UNSET
            return DELAYS_MS[(count - 1).coerceIn(0, DELAYS_MS.lastIndex)]
        }
        if (count > OTHER_TRIES) return C.TIME_UNSET
        return super.getRetryDelayMsFor(loadErrorInfo)
    }
}
