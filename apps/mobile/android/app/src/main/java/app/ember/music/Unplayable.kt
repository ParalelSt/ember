package app.ember.music

import androidx.media3.datasource.HttpDataSource

/** A song the player could not play, on its way to the web app, which turns
 *  it into the message ("Couldn't play X: not available on YouTube. Skipped
 *  to the next song.") and greys the song in its queue. The wording lives in
 *  the web app (lib/playback/unplayable.ts), so every device says the same. */
data class UnplayableNotice(
    val trackId: String,
    val title: String,
    /** [Unplayable.UNAVAILABLE] (the host answered 410: YouTube no longer has
     *  it) or [Unplayable.TRANSIENT] (it would not load right now). */
    val kind: String,
    /** The host's reason code, for an unavailable song. */
    val reason: String?,
    /** [Unplayable.SKIPPED], [Unplayable.STOPPED], [Unplayable.GAVE_UP] or
     *  [Unplayable.FLAGGED] (found out by a prefetch, nothing skipped yet). */
    val outcome: String,
)

/** Reading a failed load: which HTTP answer it was and what the host said. */
object Unplayable {
    const val UNAVAILABLE = "unavailable"
    const val TRANSIENT = "transient"
    const val SKIPPED = "skipped"
    const val STOPPED = "stopped"
    const val GAVE_UP = "gave-up"
    const val FLAGGED = "flagged"

    /** lib/sources/youtube's UnavailableReason codes. */
    private val REASONS = setOf("removed", "private", "geo", "members", "terminated", "age", "unavailable")
    private val REASON_RE = Regex("\"reason\"\\s*:\\s*\"([a-z]+)\"")

    /** The status and body of the HTTP answer behind a failure, wherever it
     *  sits in the cause chain (the cache and data source layers wrap it).
     *  Null when the failure was not an HTTP answer (no connection, a file). */
    fun httpFailure(error: Throwable?): Pair<Int, ByteArray?>? {
        var e = error
        var depth = 0
        while (e != null && depth++ < 10) {
            if (e is HttpDataSource.InvalidResponseCodeException) return e.responseCode to e.responseBody
            e = e.cause
        }
        return null
    }

    /** 410 is the host's "YouTube says this video is gone" (the stream route's
     *  unavailable answer). Anything else may play later. */
    fun kindOf(status: Int?): String = if (status == 410) UNAVAILABLE else TRANSIENT

    /** The `reason` from the host's 410 body ({"unavailable":true,"reason":"removed"}),
     *  when it is one the app knows. */
    fun reasonFrom(body: ByteArray?): String? {
        if (body == null || body.isEmpty()) return null
        val text = String(body, 0, minOf(body.size, 4096), Charsets.UTF_8)
        return REASON_RE.find(text)?.groupValues?.get(1)?.takeIf { it in REASONS }
    }

    fun notice(trackId: String, title: String, error: Throwable?, outcome: String): UnplayableNotice {
        val http = httpFailure(error)
        val kind = kindOf(http?.first)
        val reason = if (kind == UNAVAILABLE) reasonFrom(http?.second) ?: "unavailable" else null
        return UnplayableNotice(trackId, title, kind, reason, outcome)
    }
}

/** Notices on their way to the web app, without spamming a listener who is
 *  not looking.
 *
 *  On screen, each one is handed over as it happens. With the app in the
 *  background (screen off, another app, the car) they are held, and handed
 *  over together when the app comes back, where the web app shows ONE
 *  summary. No notification: the music has already moved on by itself, and
 *  a notification per dead song would be noise. With no page at all (the app
 *  swiped away while the music went on) they wait for the next page, which
 *  asks for them as it starts ([drain]).
 *
 *  Process-wide, like NativeLog: the service records, the plugin delivers. */
object UnplayableNotices {
    /** Newest kept: past this, the summary says enough. */
    const val MAX_HELD = 20

    private val held = ArrayDeque<UnplayableNotice>()
    /** Returns false when the page could not take them (no listener yet). */
    private var sink: ((List<UnplayableNotice>) -> Boolean)? = null
    private var onScreen = false

    @Synchronized
    fun record(notice: UnplayableNotice) {
        held.addLast(notice)
        while (held.size > MAX_HELD) held.removeFirst()
        if (onScreen) deliver()
    }

    @Synchronized
    fun attach(sink: (List<UnplayableNotice>) -> Boolean) {
        this.sink = sink
    }

    /** Only if it is still ours: a newer plugin instance may have taken over. */
    @Synchronized
    fun detach(sink: (List<UnplayableNotice>) -> Boolean) {
        if (this.sink === sink) this.sink = null
    }

    /** The app came to the front (true) or left it (false). Coming back hands
     *  over everything held while away, as one batch. */
    @Synchronized
    fun setOnScreen(on: Boolean) {
        onScreen = on
        if (on) deliver()
    }

    /** Everything held, once: for a page that has just started. */
    @Synchronized
    fun drain(): List<UnplayableNotice> {
        val out = held.toList()
        held.clear()
        return out
    }

    private fun deliver() {
        val s = sink ?: return
        if (held.isEmpty()) return
        val batch = held.toList()
        val delivered = try { s(batch) } catch (e: Exception) { false }
        if (delivered) held.clear()
    }

    /** Tests only: process-wide state. */
    internal fun reset() {
        synchronized(this) {
            held.clear()
            sink = null
            onScreen = false
        }
    }
}
