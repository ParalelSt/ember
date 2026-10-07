package app.ember.music

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.util.Log
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.HttpDataSource
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/** Runs [task] after [ms] on a thread of its own; the returned function
 *  cancels it. Not the main looper: the watchdog has to fire while the main
 *  thread is stuck (in the car, inside requestAudioFocus). */
fun interface Delay {
    fun after(ms: Long, task: Runnable): () -> Unit
}

/** Where the player is used, as the admin's "Car and Android Auto" view
 *  groups it: a phone, a phone projecting to a car (Android Auto), or a car
 *  running Android itself (AAOS). */
object Surfaces {
    const val PHONE = "phone"
    const val ANDROID_AUTO = "android-auto"
    const val AAOS = "aaos"

    fun of(automotive: Boolean, carMode: Boolean, carConnected: Boolean): String = when {
        automotive -> AAOS
        carMode || carConnected -> ANDROID_AUTO
        else -> PHONE
    }

    fun isAutomotive(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)

    fun isCarMode(context: Context): Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_CAR
}

/** What may leave the device in a log event: a URL becomes its host (a
 *  stream URL can carry a signed token, a search its words), a secret-named
 *  field is dropped, the session cookie never survives in text, and every
 *  string is capped. */
object LogRedact {
    const val MAX_STRING = 300
    private const val MAX_DEPTH = 3
    private const val MAX_ARRAY = 10
    private val SECRET_KEY = Regex("cookie|token|authorization|password|secret|pb_auth|signature|sig$|session|email", RegexOption.IGNORE_CASE)
    private val URL = Regex("""\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s"'<>]+""")
    private val PB_AUTH = Regex("""pb_auth=[^;\s]*""", RegexOption.IGNORE_CASE)
    private val BEARER = Regex("""\bbearer\s+\S+""", RegexOption.IGNORE_CASE)

    /** The host of [url] only; null when it has none (a file, garbage). */
    fun host(url: String?): String? {
        if (url.isNullOrBlank()) return null
        url.toHttpUrlOrNull()?.let { return it.host }
        return runCatching { java.net.URI(url).host }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    /** Where a media item plays from: the stream's host, or "file" for a
     *  download; never the URL itself. */
    fun source(uri: String?): String? = when {
        uri.isNullOrBlank() -> null
        uri.startsWith("file:") || uri.startsWith("/") -> "file"
        else -> host(uri) ?: uri.substringBefore(':').take(16)
    }

    fun text(s: String): String {
        var out = URL.replace(s) { m -> host(m.value) ?: "[url]" }
        out = PB_AUTH.replace(out, "pb_auth=[scrubbed]")
        out = BEARER.replace(out, "bearer [scrubbed]")
        return if (out.length > MAX_STRING) out.take(MAX_STRING) + "…" else out
    }

    fun data(json: JSONObject?): JSONObject? = json?.let { obj(it, 0) }

    private fun obj(json: JSONObject, depth: Int): JSONObject {
        val out = JSONObject()
        val keys = json.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (SECRET_KEY.containsMatchIn(k)) continue
            val v = value(json.opt(k), depth) ?: continue
            out.put(k.take(40), v)
        }
        return out
    }

    private fun value(v: Any?, depth: Int): Any? = when (v) {
        null, JSONObject.NULL -> null
        is String -> text(v)
        is Number, is Boolean -> v
        is JSONObject -> if (depth >= MAX_DEPTH) null else obj(v, depth + 1)
        is JSONArray -> if (depth >= MAX_DEPTH) null else JSONArray().also { arr ->
            for (i in 0 until minOf(v.length(), MAX_ARRAY)) value(v.opt(i), depth + 1)?.let { arr.put(it) }
        }
        else -> text(v.toString())
    }
}

/** The player's own log, sent to the server (`POST /api/native-log`) with no
 *  page open: Android Auto and the AAOS car run only the player service, and
 *  NativeLog only reaches the server through a WebView bug report.
 *
 *  Events wait in a capped buffer (the oldest go first) and leave in batches:
 *  when [BATCH] have gathered, [FLUSH_MS] after the first one, or at once for
 *  an error. Offline nothing is sent and the buffer waits; a batch the server
 *  does not take (signed out, rate limited, the network gone mid-send) is
 *  dropped without a word. Logging must never cost the music anything. */
class PlaybackLog(
    /** Sends one batch; throws when it was not accepted. Runs on [io]. */
    private val send: (JSONObject) -> Unit,
    private val online: () -> Boolean,
    private val io: Executor,
    private val delay: Delay,
    private val surface: () -> String,
    private val device: JSONObject,
    private val clock: () -> Long = System::currentTimeMillis,
    /** One per process: the admin view keeps a run's events together. */
    val session: String = UUID.randomUUID().toString(),
) {
    companion object {
        const val TAG = "EmberLog"
        const val MAX_BUFFERED = 200
        const val BATCH = 25
        const val FLUSH_MS = 30_000L
        private val EVENT = Regex("^[a-z][a-z0-9._-]{0,39}$")
    }

    private val buffer = java.util.ArrayDeque<JSONObject>()
    private var dropped = 0
    private var inFlight = false
    private var timerArmed = false

    fun info(event: String, message: String, data: JSONObject? = null) = log("info", event, message, data)
    fun warn(event: String, message: String, data: JSONObject? = null) = log("warn", event, message, data)
    fun error(event: String, message: String, data: JSONObject? = null) = log("error", event, message, data)

    fun log(level: String, event: String, message: String, data: JSONObject? = null) {
        val name = event.lowercase().takeIf { EVENT.matches(it) } ?: "event"
        val text = LogRedact.text(message)
        when (level) {
            "error" -> Log.e(TAG, "$name: $text")
            "warn" -> Log.w(TAG, "$name: $text")
            else -> Log.i(TAG, "$name: $text")
        }
        val e = JSONObject()
            .put("ts", clock())
            .put("level", level)
            .put("event", name)
            .put("message", text)
            .put("surface", runCatching { surface() }.getOrDefault(Surfaces.PHONE))
        LogRedact.data(data)?.takeIf { it.length() > 0 }?.let { e.put("data", it) }
        val now: Boolean
        synchronized(this) {
            buffer.addLast(e)
            while (buffer.size > MAX_BUFFERED) { buffer.removeFirst(); dropped++ }
            now = level == "error" || buffer.size >= BATCH
            if (!now) armTimer()
        }
        if (now) flush()
    }

    private fun armTimer() {
        if (timerArmed) return
        timerArmed = true
        runCatching { delay.after(FLUSH_MS) { synchronized(this) { timerArmed = false }; flush() } }
            .onFailure { timerArmed = false }
    }

    /** Sends the oldest batch now (when online and nothing else is on its
     *  way); the rest follow. Safe from any thread. */
    fun flush() {
        val body: JSONObject
        synchronized(this) {
            if (inFlight || buffer.isEmpty()) return
            if (!runCatching { online() }.getOrDefault(false)) { armTimer(); return }
            val events = JSONArray()
            while (events.length() < BATCH && buffer.isNotEmpty()) events.put(buffer.removeFirst())
            body = JSONObject().put("session", session).put("device", device).put("events", events)
            if (dropped > 0) { body.put("dropped", dropped); dropped = 0 }
            inFlight = true
        }
        try {
            io.execute {
                try { send(body) } catch (e: Throwable) { Log.i(TAG, "log batch not sent: ${e.message}") }
                val more = synchronized(this) {
                    inFlight = false
                    buffer.isNotEmpty().also { if (it && buffer.size < BATCH) armTimer() }
                }
                if (more && pendingCount() >= BATCH) flush()
            }
        } catch (e: RejectedExecutionException) {
            synchronized(this) { inFlight = false }
        }
    }

    @Synchronized fun pendingCount(): Int = buffer.size

    /** Tests: what is still waiting, oldest first. */
    @Synchronized internal fun pending(): List<JSONObject> = buffer.toList()
}

/** "Play did not start within N s", and what the audio focus request did.
 *
 *  Armed just before the session's player is told to play (LevelPlayer
 *  calls [beforePlay]/[afterPlay] around it): ExoPlayer asks for audio focus
 *  inside play(), and a car whose focus policy never answers keeps that call,
 *  and the main thread, waiting until Android kills the app (2026-10-07).
 *  The check runs on [delay]'s thread, so it reports, and the batch goes
 *  out, even then. Also logs state changes and player errors. */
class PlayWatch(
    private val log: PlaybackLog,
    private val delay: Delay,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Who asked (the car, the app, a headset): a package name, or null. */
    private val caller: () -> String? = { null },
    val timeoutMs: Long = TIMEOUT_MS,
) : Player.Listener {
    companion object {
        const val TIMEOUT_MS = 8_000L
        const val SLOW_FOCUS_MS = 1_000L

        fun stateName(state: Int) = when (state) {
            Player.STATE_IDLE -> "idle"
            Player.STATE_BUFFERING -> "buffering"
            Player.STATE_READY -> "ready"
            Player.STATE_ENDED -> "ended"
            else -> "state $state"
        }

        fun suppressionName(reason: Int) = when (reason) {
            Player.PLAYBACK_SUPPRESSION_REASON_NONE -> "none"
            Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS -> "transient focus loss"
            Player.PLAYBACK_SUPPRESSION_REASON_UNSUITABLE_AUDIO_OUTPUT -> "unsuitable output"
            else -> "reason $reason"
        }

        /** What the focus request came to, read off the player straight after
         *  play(): Media3 holds playWhenReady back when focus is refused, and
         *  suppresses playback while it waits for a delayed grant. */
        fun focusResult(playWhenReady: Boolean, suppression: Int, state: Int): String = when {
            state == Player.STATE_IDLE -> "not asked (idle)"
            !playWhenReady -> "denied"
            suppression == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS -> "waiting"
            else -> "granted"
        }
    }

    @Volatile private var playing = false
    @Volatile private var state = Player.STATE_IDLE
    @Volatile private var playWhenReady = false
    @Volatile private var suppression = Player.PLAYBACK_SUPPRESSION_REASON_NONE
    /** When the current play() call began; 0 outside one. */
    @Volatile private var inPlaySince = 0L
    @Volatile private var armedAt = 0L
    @Volatile private var armedBy: String? = null
    @Volatile private var generation = 0
    private var cancel: (() -> Unit)? = null
    private var measuring = false

    /** Main thread, before the player's play(). */
    fun beforePlay(player: Player) {
        measuring = false
        if (player.isPlaying || player.mediaItemCount == 0) return
        if (player.playWhenReady && player.playbackState != Player.STATE_IDLE) return
        measuring = true
        val now = clock()
        val who = runCatching { caller() }.getOrNull()
        val source = LogRedact.source(player.currentMediaItem?.localConfiguration?.uri?.toString())
        log.info("play.request", "play requested", JSONObject().apply {
            who?.let { put("caller", it) }
            source?.let { put("source", it) }
            put("state", stateName(player.playbackState))
            put("queue", player.mediaItemCount)
        })
        armedAt = now
        armedBy = who
        inPlaySince = now
        val gen = ++generation
        cancel?.invoke()
        cancel = runCatching { delay.after(timeoutMs) { check(gen) } }.getOrNull()
    }

    /** Main thread, once the player's play() returned. */
    fun afterPlay(player: Player) {
        val since = inPlaySince
        inPlaySince = 0
        if (!measuring || since == 0L) return
        measuring = false
        val took = clock() - since
        val result = focusResult(player.playWhenReady, player.playbackSuppressionReason, player.playbackState)
        val data = JSONObject().put("result", result).put("ms", took)
        if (took >= SLOW_FOCUS_MS || result == "denied" || result == "waiting") log.warn("focus", "audio focus $result after $took ms", data)
        else log.info("focus", "audio focus $result after $took ms", data)
    }

    private fun disarm() {
        generation++
        cancel?.invoke()
        cancel = null
        armedAt = 0
    }

    /** On the delay's thread: the player's own fields are not safe to read
     *  here, so this works from what the listener last saw. */
    private fun check(gen: Int) {
        if (gen != generation || playing) return
        val since = inPlaySince
        val blocked = if (since != 0L) clock() - since else 0L
        val secs = timeoutMs / 1000
        val message = if (blocked > 0) "play did not start within $secs s (still inside play() after $blocked ms, waiting on audio focus?)"
            else "play did not start within $secs s"
        log.warn("play.stalled", message, JSONObject().apply {
            put("state", stateName(state))
            put("playWhenReady", playWhenReady)
            put("suppression", suppressionName(suppression))
            put("blockedMs", blocked)
            armedBy?.let { put("caller", it) }
        })
        log.flush()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        playing = isPlaying
        if (isPlaying && armedAt != 0L) {
            log.info("play.start", "playing after ${clock() - armedAt} ms", JSONObject().put("ms", clock() - armedAt))
            disarm()
        }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        state = playbackState
        log.info("state", stateName(playbackState))
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        this.playWhenReady = playWhenReady
        if (!playWhenReady) disarm()
        if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
            log.warn("focus.loss", "paused: audio focus lost")
        }
    }

    override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
        suppression = playbackSuppressionReason
        if (playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
            log.info("suppressed", "playback suppressed: ${suppressionName(playbackSuppressionReason)}")
        }
    }

    override fun onPlayerError(error: PlaybackException) {
        disarm()
        val data = JSONObject().put("errorCodeName", error.errorCodeName).put("code", error.errorCode)
        var cause: Throwable? = error.cause
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) data.put("httpStatus", cause.responseCode)
            if (cause is HttpDataSource.HttpDataSourceException) LogRedact.host(cause.dataSpec.uri.toString())?.let { data.put("host", it) }
            if (!data.has("cause")) data.put("cause", cause.javaClass.simpleName)
            cause = cause.cause
        }
        log.error("player.error", "${error.errorCodeName}: ${error.message.orEmpty()}", data)
    }
}

/** Why the app's last run ended (Android 11+): an ANR, a crash, killed for
 *  memory. Reported once, on the next start, so an ANR in the car that took
 *  the logger down with it still reaches the server. */
object ExitReasons {
    const val PREFS = "ember.exitReasons"
    private const val KEY_SEEN = "seenTs"
    /** On a first run nothing is "new"; only the last day is worth sending. */
    private const val FIRST_RUN_WINDOW_MS = 24 * 60 * 60 * 1000L

    fun name(reason: Int): String = when (reason) {
        1 -> "exit self"
        2 -> "signaled"
        3 -> "low memory"
        4 -> "crash"
        5 -> "native crash"
        6 -> "anr"
        7 -> "initialization failure"
        8 -> "permission change"
        9 -> "excessive resource usage"
        10 -> "user requested"
        11 -> "user stopped"
        12 -> "dependency died"
        13 -> "other"
        14 -> "freezer"
        15 -> "package state change"
        16 -> "package updated"
        else -> "unknown"
    }

    fun level(reason: Int): String = when (reason) {
        4, 5, 6, 7 -> "error"
        2, 3, 9, 12, 13, 14 -> "warn"
        else -> "info"
    }

    /** Logs every exit newer than the last one reported. Off the main
     *  thread: it is a binder call. */
    fun report(context: Context, log: PlaybackLog, prefs: SharedPreferences, now: Long = System.currentTimeMillis()) {
        if (Build.VERSION.SDK_INT < 30) return
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
        val infos: List<ApplicationExitInfo> = runCatching { am.getHistoricalProcessExitReasons(context.packageName, 0, 5) }
            .getOrNull() ?: return
        val seen = prefs.getLong(KEY_SEEN, -1L)
        val after = if (seen < 0) now - FIRST_RUN_WINDOW_MS else seen
        val fresh = infos.filter { it.timestamp > after }.sortedBy { it.timestamp }
        for (info in fresh) {
            val reason = name(info.reason)
            val data = JSONObject()
                .put("reason", reason)
                .put("at", info.timestamp)
                .put("importance", info.importance)
            info.description?.takeIf { it.isNotBlank() }?.let { data.put("description", it) }
            log.log(level(info.reason), "exit", "last run ended: $reason", data)
        }
        val newest = infos.maxOfOrNull { it.timestamp } ?: return
        if (newest > seen) prefs.edit().putLong(KEY_SEEN, newest).apply()
    }
}
