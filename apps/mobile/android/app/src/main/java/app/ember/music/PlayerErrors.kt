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

    /** Host answers that are not Ember's bug: signed out (401), a song
     *  YouTube refused (403) or no longer has (410, which the unplayable
     *  notice explains), a rate limit (429), and the host's own 502/503/504
     *  after its retries (the server logs those at error itself). A 404 or a
     *  500 from Ember's own routes (an upload whose file is gone, a route
     *  that crashed) is a bug, and so is a request Ember built wrong (400,
     *  416). */
    private val OUTSIDE_STATUSES = setOf(401, 403, 410, 429, 502, 503, 504)

    /** Load failures that mean "could not get it over the network": offline
     *  these are expected for a song that is not on the phone. A file that is
     *  missing, unreadable or cut short (2005, 2006, 2008) never is. */
    private val NETWORK_LOAD_CODES = setOf(
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
    )

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
     *  - the host answered one of [OUTSIDE_STATUSES];
     *  - offline, a network load of a song that is not on the phone
     *    ([NETWORK_LOAD_CODES]); [local]: the song is on the phone (a
     *    download, or whole in the auto cache), so a failure to load it is
     *    the copy's, not the network's;
     *  - a live station that will not load or sends something that is not
     *    audio (its own outage, as on the other players).
     *  A decoder or renderer failure on a song is ours, and stays an error. */
    fun outside(code: Int, httpStatus: Int?, station: Boolean, offline: Boolean, local: Boolean = false): Boolean = when {
        code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> true
        code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> true
        station && (isIo(code) || isParsing(code) || code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) -> true
        offline && !local && code in NETWORK_LOAD_CODES -> true
        code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> httpStatus != null && httpStatus in OUTSIDE_STATUSES
        else -> false
    }

    fun level(code: Int, httpStatus: Int?, station: Boolean, offline: Boolean, local: Boolean = false): String =
        if (outside(code, httpStatus, station, offline, local)) "warn" else "error"

    /** The detail a log line carries: the error code, the HTTP status, the
     *  song, whether it was a station, whether the phone was offline and
     *  whether the song is on the phone, and
     *  the verdict (`expected`) the page logs it by. */
    fun detail(error: PlaybackException, mediaId: String?, offline: Boolean, local: Boolean = false): JSONObject {
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
            .put("local", local)
            .put("expected", outside(error.errorCode, status, station, offline, local))
    }
}
