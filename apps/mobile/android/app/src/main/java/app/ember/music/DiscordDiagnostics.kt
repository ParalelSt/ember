package app.ember.music

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** A trace of what the Discord card is doing, for a phone with no logcat.
 *
 *  Off unless the build asks for it (EMBER_DISCORD_DIAG=1, app/build.gradle,
 *  docs/APPS.md): then every step goes out through the player log
 *  (PlaybackLog), whose batches reach POST /api/native-log as event
 *  "discord.diag", category "native". Lines wait in a bounded queue until the
 *  player service has made its log and the app has a session cookie to file
 *  them under. Everything here swallows its own failures, never touches
 *  playback, and sends from one background thread. */
object DiscordDiagnostics {
    const val EVENT = "discord.diag"
    const val TAG = "EmberDiscordDiag"
    private const val QUEUE_MAX = 300
    private const val TICK_MS = 8_000L
    private const val PER_TICK = 25

    /** The build's switch; tests turn it on. */
    @Volatile internal var enabled: Boolean = BuildConfig.DISCORD_DIAG

    /** One per process, in front of every line, so runs can be told apart. */
    private val run = UUID.randomUUID().toString().take(4)
    private var seq = 0
    private val queue = DiagQueue(QUEUE_MAX)
    private var sink: PlaybackLog? = null
    private var canSend: () -> Boolean = { false }
    private var ticker: ScheduledExecutorService? = null
    private var lastChanged: String? = null
    private var started = false

    /** Starts the sender once; the first call also says who and what this is. */
    fun init(context: Context) {
        if (!enabled) return
        runCatching {
            val first = synchronized(this) {
                if (ticker == null) {
                    ticker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "ember-diag").apply { isDaemon = true } }
                        .also { it.scheduleWithFixedDelay({ tick() }, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS) }
                }
                (!started).also { started = true }
            }
            if (first) appStarted(context)
        }
    }

    private fun appStarted(context: Context) {
        val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull()
        val prefs = DiscordSharing.prefs(context)
        val stored = if (prefs.contains(DiscordSharing.SHARE_KEY)) DiscordSharing.load(prefs).toString() else "never set (reads as ${if (DiscordSharing.load(prefs)) "on" else "off"})"
        add("app started: ${context.packageName} $version, api ${Build.VERSION.SDK_INT}, ${Build.MANUFACTURER} ${Build.MODEL}")
        add("stored discord switch at startup: $stored")
    }

    /** The player service made its log: from now on queued lines can leave.
     *  [signedIn] says whether a session cookie exists to file them under. */
    fun attachLog(log: PlaybackLog, signedIn: () -> Boolean) {
        if (!enabled) return
        runCatching { synchronized(this) { sink = log; canSend = signedIn } }
    }

    fun detachLog(log: PlaybackLog) {
        runCatching {
            synchronized(this) { if (sink === log) sink = null }
            // What is left goes now, while the service still flushes its log.
            tick(log)
        }
    }

    internal fun tick(via: PlaybackLog? = null) {
        runCatching {
            val log: PlaybackLog
            val lines: List<String>
            synchronized(this) {
                log = via ?: sink ?: return
                if (queue.isEmpty() || !runCatching { canSend() }.getOrDefault(false)) return
                lines = queue.take(PER_TICK)
            }
            lines.forEach { log.info(EVENT, it, JSONObject().put("run", run)) }
            log.flush()
        }
    }

    /** Like [add], but not again while the same text was the last one added this way. */
    fun addIfChanged(message: String) {
        if (!enabled) return
        synchronized(this) { if (lastChanged == message) return; lastChanged = message }
        add(message)
    }

    /** What the phone has: once per start and whenever the switch moves. */
    fun environment(context: Context, switchOn: Boolean) {
        if (!enabled) return
        runCatching {
            val discord = runCatching {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo("com.discord", 0).versionName
            }.getOrNull()
            add(DiagText.environment(switchOn, BuildConfig.DISCORD_APP_ID.isNotEmpty(), discord, DiscordSdkBridge.PRESENT, Build.VERSION.SDK_INT))
        }
    }

    fun add(message: String) {
        if (!enabled) return
        runCatching {
            val line = synchronized(this) { "[$run#${++seq}] $message".also { queue.add(it) } }
            // Also for adb, on the emulator or a phone on a cable.
            Log.i(TAG, line)
        }
    }

    /** Tests: start from nothing. */
    internal fun reset() = synchronized(this) {
        queue.clear(); sink = null; canSend = { false }; lastChanged = null; seq = 0
    }
}

/** The waiting lines: oldest dropped past [max], each one line, cut short. */
class DiagQueue(private val max: Int, private val maxLine: Int = 300) {
    private val lines = ArrayDeque<String>()

    @Synchronized fun add(line: String) {
        val clean = line.replace('\n', ' ').replace('\r', ' ').trim()
        lines.addLast(if (clean.length > maxLine) clean.substring(0, maxLine) + "..." else clean)
        while (lines.size > max) lines.removeFirst()
    }

    @Synchronized fun take(n: Int): List<String> {
        val out = ArrayList<String>(minOf(n, lines.size))
        while (out.size < n && lines.isNotEmpty()) out.add(lines.removeFirst())
        return out
    }

    @Synchronized fun isEmpty() = lines.isEmpty()
    @Synchronized fun clear() = lines.clear()
    @Synchronized fun size() = lines.size
}

/** The diagnostic sentences that need a decision, kept pure for tests. */
object DiagText {
    fun environment(switchOn: Boolean, appIdSet: Boolean, discordVersion: String?, sdkInBuild: Boolean, android: Int): String =
        "env: switch ${if (switchOn) "on" else "off"}, app id ${if (appIdSet) "set" else "EMPTY"}, " +
            "discord ${if (discordVersion != null) "installed $discordVersion" else "NOT installed (or not visible)"}, " +
            "sdk ${if (sdkInBuild) "in build" else "NOT in build"}, android $android"
}
