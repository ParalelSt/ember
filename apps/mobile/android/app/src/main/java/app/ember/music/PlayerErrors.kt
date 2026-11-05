package app.ember.music

import androidx.media3.common.PlaybackException
import org.json.JSONObject

/** What a player error was, for the logs: the server's native log
 *  (PlayWatch) and the web app's own log line, which feeds the automatic bug
 *  reports at error level. Before, the page heard only the exception's
 *  message ("Source error"), which says nothing about what failed, and every
 *  one became a bug report, a phone in a tunnel and a dead station included.
 *
 *  The web app has the same rule for the desktop and browser players (a host
 *  refusal or a dead station is a warning there too). */
object PlayerErrors {
    /** HttpDataSource.InvalidResponseCodeException's message. */
    private val RESPONSE_CODE = Regex("""Response code: (\d{3})""")

    /** Statuses that are a request Ember built wrong (a bad id, a range past
     *  the end), so the app's own bug. */
    private val OWN_FAULT_STATUSES = setOf(400, 416)

    /** The HTTP status behind [error]. The service's player has the real
     *  exception in the cause chain; the page's MediaController gets a copy
     *  of the error that keeps only the first cause's message, so it is read
     *  from there. Null when the failure was not an HTTP answer. */
    fun httpStatus(error: Throwable?): Int? {
        Unplayable.httpFailure(error)?.first?.let { return it }
        var e = error?.cause
        var depth = 0
        while (e != null && depth++ < 10) {
            e.message?.let { RESPONSE_CODE.find(it) }?.let { return it.groupValues[1].toInt() }
            e = e.cause
        }
        return null
    }

    fun isStation(mediaId: String?): Boolean = mediaId?.startsWith("station:") == true

    private fun isIo(code: Int) = code in 2000..2999
    private fun isParsing(code: Int) = code in 3000..3999

    /** Whether the failure is outside Ember, so a warning and never an
     *  automatic bug report:
     *  - the connection gave out (no network, a timeout);
     *  - the host answered with an error status: a song YouTube no longer
     *    has (410, which the unplayable notice already explains), one it
     *    refused (403), the host's own 502 after its retries (the server logs
     *    that side at error itself), being signed out. A 400 or 416 is a
     *    request Ember built wrong and stays an error;
     *  - any load failure while the phone is offline;
     *  - a live station that will not load or sends something that is not
     *    audio (its own outage, as on the other players).
     *  A decoder or renderer failure on a song is ours, and stays an error. */
    fun outside(code: Int, httpStatus: Int?, station: Boolean, offline: Boolean): Boolean = when {
        code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> true
        code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> true
        code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> httpStatus == null || httpStatus !in OWN_FAULT_STATUSES
        offline && isIo(code) -> true
        station && (isIo(code) || isParsing(code) || code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) -> true
        else -> false
    }

    fun level(code: Int, httpStatus: Int?, station: Boolean, offline: Boolean): String =
        if (outside(code, httpStatus, station, offline)) "warn" else "error"

    /** The detail a log line carries: the error code, the HTTP status, the
     *  song, whether it was a station and whether the phone was offline, and
     *  the verdict (`expected`) the page logs it by. */
    fun detail(error: PlaybackException, mediaId: String?, offline: Boolean): JSONObject {
        val status = httpStatus(error)
        val station = isStation(mediaId)
        return JSONObject()
            .put("errorCodeName", error.errorCodeName)
            .put("code", error.errorCode)
            .apply {
                status?.let { put("httpStatus", it) }
                mediaId?.let { put("trackId", it) }
            }
            .put("station", station)
            .put("offline", offline)
            .put("expected", outside(error.errorCode, status, station, offline))
    }
}
