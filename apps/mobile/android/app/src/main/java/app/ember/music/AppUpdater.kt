package app.ember.music

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** What the updater needs to know about the rest of the app: whether music
 *  plays, whether a car is on the other end, whether the window is on
 *  screen. The player service and the plugin keep it current; the updater
 *  looks again whenever it changes. Same process, so plain fields. */
object UpdatePresence {
    @Volatile var playing = false
        private set
    @Volatile var carConnected = false
        private set
    @Volatile var foreground = false
        private set
    /** When playing or being on screen last ended; 0 = not this run. */
    @Volatile private var activeUntil = 0L
    @Volatile var onChange: (() -> Unit)? = null

    private fun changed() = runCatching { onChange?.invoke() }

    fun setPlaying(on: Boolean, now: Long = System.currentTimeMillis()) {
        if (playing == on) return
        if (!on) activeUntil = now
        playing = on
        changed()
    }

    fun setCar(on: Boolean) {
        if (carConnected == on) return
        carConnected = on
        changed()
    }

    fun setForeground(on: Boolean, now: Long = System.currentTimeMillis()) {
        if (foreground == on) return
        if (!on) activeUntil = now
        foreground = on
        changed()
    }

    /** How long nothing has played and the app has been off screen. */
    fun idleMs(now: Long = System.currentTimeMillis()): Long = when {
        playing || foreground -> 0L
        activeUntil == 0L -> Long.MAX_VALUE
        else -> (now - activeUntil).coerceAtLeast(0L)
    }

    internal fun reset() {
        playing = false; carConnected = false; foreground = false; activeUntil = 0L; onChange = null
    }
}

/** Ember's Android app updating itself from the Ember server, the way the
 *  desktop app does (apps/desktop/src-tauri/src/update.rs).
 *
 *  Asks GET /api/android/update on app start and every 6 hours
 *  (UpdateCheckJob), downloads the APK into the app's cache over a working
 *  network (Wi-Fi or mobile data), checks that it is the next Ember signed
 *  with the same key, and installs it with a PackageInstaller session
 *  (UpdateInstaller) only when that interrupts nobody: never in the car,
 *  never by itself while music plays (UpdateRules.decide).
 *
 *  Every step goes to the server's native log (PlaybackLog, category
 *  "native", events "update.*"), so the admin's car page shows it. Failures
 *  are quiet for the person: a broken update must never stop the music. */
@SuppressLint("StaticFieldLeak") // only ever the application context
object AppUpdater {
    const val TAG = "EmberUpdate"
    private const val PREFS = "ember.update"
    private const val KEY_LAST_CHECK = "lastCheck"
    private const val KEY_READY_VERSION = "readyVersion"
    private const val KEY_READY_CODE = "readyCode"
    private const val KEY_READY_PATH = "readyPath"
    private const val KEY_REJECTED = "rejectedVersion"
    private const val KEY_INSTALLING = "installingVersion"
    private const val KEY_INSTALL_AT = "installStartedAt"
    /** The install session this app committed last and has no final
     *  answer for yet. */
    private const val KEY_SESSION = "installSession"
    /** The session's last sign of life (UpdateRules.INSTALL_BACKSTOP_MS). */
    private const val KEY_ACTIVITY_AT = "installActivityAt"
    /** Larger than any Ember APK will be; a server answering more is wrong. */
    private const val MAX_APK_BYTES = 300L * 1024 * 1024

    enum class Status(val wire: String) {
        IDLE("idle"), CHECKING("checking"), UP_TO_DATE("up-to-date"), DOWNLOADING("downloading"),
        READY("ready"), INSTALLING("installing"), FAILED("failed"),
    }

    data class Ready(val version: String, val versionCode: Long, val file: File)

    private lateinit var app: Context
    private var baseUrl = ""
    /** Downloads and staging, one at a time. Tests run it in place. */
    internal var work: java.util.concurrent.Executor = Executors.newSingleThreadExecutor()
    /** Tests set the time. */
    internal var clock: () -> Long = System::currentTimeMillis
    /** Tests: the log to use in place of the server's. */
    private var testLog: PlaybackLog? = null
    @Volatile private var initialized = false
    private val logIo = Executors.newSingleThreadExecutor()
    private val logTimer = Executors.newSingleThreadScheduledExecutor()
    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val listeners = CopyOnWriteArraySet<(JSONObject) -> Unit>()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private lateinit var log: PlaybackLog

    @Volatile private var status = Status.IDLE
    @Volatile private var latest: String? = null
    @Volatile private var progress: Double? = null
    @Volatile private var error: String? = null
    @Volatile private var waiting: String? = null
    @Volatile private var ready: Ready? = null
    /** A check or an install commit is under way (one at a time). */
    private val busy = java.util.concurrent.atomic.AtomicBoolean(false)
    /** Looks at the session while INSTALLING (checkInstall). */
    private val watch = Runnable { checkInstall() }
    /** When the session was first seen gone with no answer; 0 = it is not. */
    @Volatile private var goneSince = 0L
    /** The system's confirm screen for a session that needs the person. */
    @Volatile private var pendingConfirm: Intent? = null
    /** The person said no (or the install failed) this run: no more tries
     *  by itself until they tap. */
    @Volatile private var autoBlocked = false
    /** When the current install began (KEY_INSTALL_AT), for the log. */
    @Volatile private var installStartedAt = 0L
    /** KEY_SESSION, in memory. */
    @Volatile private var sessionId: Int? = null
    /** KEY_ACTIVITY_AT, in memory. */
    @Volatile private var activityAt = 0L
    /** The launch gate asked for the install and evaluate(true) has not run
     *  for it yet. States published meanwhile (onStart's and refresh()'s
     *  re-evaluation, still "ready") say so, so the gate does not read them
     *  as the install having failed. */
    @Volatile private var gatePending = false
    private var activity: WeakReference<Activity>? = null
    private var lastDecision: UpdateRules.Decision? = null

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        initialized = true
        app = context.applicationContext
        baseUrl = ServerConfig.baseUrl(app)
        log = testLog ?: buildLog()
        restore()
        UpdatePresence.onChange = { main.post { evaluate(false) } }
        if (UpdateRules.isTestBuild(app.packageName)) runCatching { UpdateCheckJob.cancel(app) }
        else runCatching { UpdateCheckJob.schedule(app) }.onFailure { log.warn("update.schedule", "periodic check not scheduled: ${it.message}") }
    }

    /** Tests: forget everything, so the next init() starts like a new
     *  process on the test's Application, with [log] and [work]. */
    @Synchronized
    internal fun resetForTest(log: PlaybackLog?, work: java.util.concurrent.Executor, clock: () -> Long = System::currentTimeMillis) {
        initialized = false
        testLog = log
        this.work = work
        this.clock = clock
        status = Status.IDLE
        latest = null; progress = null; error = null; waiting = null; ready = null
        busy.set(false)
        pendingConfirm = null; autoBlocked = false; goneSince = 0L
        installStartedAt = 0L; sessionId = null; activityAt = 0L; gatePending = false
        activity = null; lastDecision = null
        listeners.clear()
        main.removeCallbacksAndMessages(null)
    }

    fun isReady(): Boolean = ready != null && status != Status.INSTALLING

    /** The version of the downloaded, verified APK that waits, if any. */
    fun readyVersion(): String? = ready?.takeIf { it.file.exists() }?.version

    /** The launch gate asks for the notification permission before
     *  installFromGate: states published meanwhile are from before the
     *  install too. Released when the gate goes away without installing. */
    fun holdForGate() { gatePending = true }
    fun releaseGateHold() { gatePending = false }

    /** A version refused for good (UpdateRules.isPermanent), if any. */
    fun rejectedVersion(): String? = prefs().getString(KEY_REJECTED, null)

    /** The launch gate's countdown ended, or the person pressed "Update
     *  now" (LaunchGateActivity): install the waiting APK now, as a tap on
     *  Install would. The person is looking at the gate and chose it, so the
     *  "never while on screen" rule does not apply; the car and the install
     *  permission still do (UpdateRules.decide). False when nothing waits. */
    fun installFromGate(a: Activity): Boolean {
        if (readyVersion() == null) return false
        gatePending = true
        attachActivity(a)
        UpdatePresence.setForeground(true)
        var tries = 0
        main.post(object : Runnable {
            override fun run() {
                // The check that downloaded it may still be finishing.
                if (busy.get() && tries++ < 50) { main.postDelayed(this, 200); return }
                gatePending = false
                tap()
            }
        })
        return true
    }

    /** The launch gate's telemetry ("update.gate.*"), through the same log
     *  as the updater's own. */
    fun gateEvent(event: String, message: String, data: JSONObject? = null, level: String = "info") {
        if (!::log.isInitialized) return
        log.log(level, event, message, data)
        if (level != "info") log.flush()
    }

    fun addListener(l: (JSONObject) -> Unit) { listeners.add(l) }
    fun removeListener(l: (JSONObject) -> Unit) { listeners.remove(l) }

    fun attachActivity(a: Activity?) {
        activity = a?.let { WeakReference(it) }
    }

    // ── State ───────────────────────────────────────────────────────────

    fun stateJson(): JSONObject {
        val o = JSONObject().put("status", status.wire)
        AppVersion.name(app)?.let { o.put("current", it) }
        o.put("currentCode", installedCode())
        latest?.let { o.put("latest", it) }
        progress?.let { o.put("progress", it) }
        waiting?.let { o.put("waiting", it) }
        error?.let { o.put("error", it) }
        o.put("checkedAt", prefs().getLong(KEY_LAST_CHECK, 0L))
        o.put("needsPermission", !canInstall())
        o.put("silent", silentLikely())
        if (gatePending) o.put("gatePending", true)
        return o
    }

    private fun publish() {
        val s = runCatching { stateJson() }.getOrNull() ?: return
        listeners.forEach { l -> runCatching { l(s) } }
    }

    @Synchronized
    private fun set(status: Status, latest: String? = this.latest, progress: Double? = null, error: String? = null, waiting: String? = null) {
        this.status = status
        this.latest = latest
        this.progress = progress
        this.error = error
        this.waiting = waiting
        publish()
    }

    private fun prefs() = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** A verified APK from an earlier run still waits; an update that went
     *  in since is cleaned up and logged. */
    private fun restore() {
        val p = prefs()
        val installing = p.getString(KEY_INSTALLING, null)
        val version = p.getString(KEY_READY_VERSION, null)
        val code = p.getLong(KEY_READY_CODE, 0L)
        val path = p.getString(KEY_READY_PATH, null)
        val file = path?.let(::File)
        val current = installedCode()
        sessionId = p.getInt(KEY_SESSION, -1).takeIf { it >= 0 }
        activityAt = p.getLong(KEY_ACTIVITY_AT, 0L)
        installStartedAt = p.getLong(KEY_INSTALL_AT, 0L)
        if (installing != null && version == installing && code in 1..current) {
            log.info("update.installed", "now on ${AppVersion.name(app)}", JSONObject().put("version", AppVersion.name(app)).put("versionCode", current))
        }
        if (version != null && file != null && file.exists() && code > current) {
            ready = Ready(version, code, file)
            latest = version
            status = Status.READY
        } else {
            clearReady()
        }
    }

    private fun clearReady() {
        ready = null
        prefs().edit().remove(KEY_READY_VERSION).remove(KEY_READY_CODE).remove(KEY_READY_PATH).remove(KEY_INSTALLING).apply()
        runCatching { File(app.cacheDir, "updates").listFiles()?.forEach { it.delete() } }
    }

    // ── Checking and downloading ────────────────────────────────────────

    /** On app start: at most every [UpdateRules.START_CHECK_MIN_MS]. */
    fun checkOnStart() {
        val last = prefs().getLong(KEY_LAST_CHECK, 0L)
        if (UpdateRules.checkDue(System.currentTimeMillis(), last, UpdateRules.START_CHECK_MIN_MS)) check(manual = false, reason = "start")
        else main.post { evaluate(false) }
    }

    /** Ask the server, download what is newer, then see whether it may
     *  install. [done] runs when all of that has finished (the job's end). */
    fun check(manual: Boolean, reason: String, done: (() -> Unit)? = null) {
        if (!UpdateRules.backgroundCheckAllowed(app.packageName, manual)) { done?.let { main.post(it) }; return }
        if (status == Status.INSTALLING || !busy.compareAndSet(false, true)) { done?.let { main.post(it) }; return }
        work.execute {
            try {
                runCheck(manual, reason)
            } catch (e: Exception) {
                Log.w(TAG, "update check failed", e)
                log.warn("update.failed", "update check failed: ${e.message}", JSONObject().put("reason", reason))
                if (ready == null) {
                    if (manual) set(Status.FAILED, error = "Couldn't check for updates") else set(Status.IDLE)
                } else {
                    publish()
                }
            } finally {
                busy.set(false)
                main.post { evaluate(false) }
                done?.let { main.post(it) }
            }
        }
    }

    private fun runCheck(manual: Boolean, reason: String) {
        if (status == Status.INSTALLING) return
        val net = netFacts()
        if (!UpdateRules.canDownload(net)) {
            log.info("update.skip", "no working network, update check skipped", JSONObject().put("reason", reason))
            if (manual) set(if (ready != null) Status.READY else Status.FAILED, error = "You're offline")
            return
        }
        val current = AppVersion.name(app)
        val currentCode = installedCode()
        if (ready == null) set(Status.CHECKING)
        val url = "$baseUrl/api/android/update?version=${current.orEmpty()}&versionCode=$currentCode"
        val feed: UpdateRules.Feed? = http.newCall(Request.Builder().url(url).build()).execute().use { res ->
            prefs().edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()
            when {
                res.code == 204 -> null
                !res.isSuccessful -> throw IOException("update feed -> ${res.code}")
                else -> UpdateRules.parseFeed(runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull())
            }
        }
        if (feed == null || !UpdateRules.offerIsNewer(feed, current, currentCode)) {
            log.info("update.check", "up to date on $current", JSONObject().put("reason", reason).put("version", current))
            if (ready == null) set(Status.UP_TO_DATE, latest = current) else publish()
            return
        }
        log.info("update.available", "update ${feed.version} available (on $current)",
            JSONObject().put("version", feed.version).put("current", current).put("reason", reason).put("size", feed.size))
        val have = ready
        if (have != null && have.version == feed.version && have.file.exists()) { set(Status.READY, latest = feed.version); return }
        if (UpdateRules.skipRejected(prefs().getString(KEY_REJECTED, null), feed.version, manual)) {
            log.info("update.skip", "update ${feed.version} was refused before, not downloading again")
            set(Status.FAILED, latest = feed.version, error = "This update can't be installed over this app")
            return
        }
        download(feed)
    }

    private fun download(feed: UpdateRules.Feed) {
        val target = baseUrl.toHttpUrlOrNull()?.resolve(feed.url)
            ?: throw IOException("bad download url")
        if (target.scheme != "https" && target.scheme != "http") throw IOException("bad download scheme")
        val dir = File(app.cacheDir, "updates").apply { mkdirs() }
        clearReady()
        dir.mkdirs()
        val part = File(dir, "ember-${feed.version}.apk.part")
        val apk = File(dir, "ember-${feed.version}.apk")
        set(Status.DOWNLOADING, latest = feed.version, progress = 0.0)
        log.info("update.download", "downloading ${feed.version}", JSONObject().put("version", feed.version).put("size", feed.size))
        val started = System.currentTimeMillis()
        val sha = MessageDigest.getInstance("SHA-256")
        http.newCall(Request.Builder().url(target).build()).execute().use { res ->
            if (!res.isSuccessful) throw IOException("download -> ${res.code}")
            val body = res.body ?: throw IOException("download: empty body")
            val total = body.contentLength().takeIf { it > 0 } ?: feed.size.takeIf { it > 0 } ?: -1L
            if (total > MAX_APK_BYTES) throw IOException("download: $total bytes is too large")
            var done = 0L
            var shown = -1
            var lastNetCheck = 0L
            body.byteStream().use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        sha.update(buf, 0, n)
                        done += n
                        if (done > MAX_APK_BYTES) throw IOException("download: too large")
                        // The network went away mid-download (left Wi-Fi with
                        // no data): stop rather than wait out the timeout.
                        if (done - lastNetCheck >= 2L * 1024 * 1024) {
                            lastNetCheck = done
                            if (!UpdateRules.canDownload(netFacts())) throw IOException("network lost")
                        }
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != shown) { shown = pct; set(Status.DOWNLOADING, latest = feed.version, progress = pct / 100.0) }
                        }
                    }
                }
            }
        }
        val hex = sha.digest().joinToString("") { "%02x".format(it) }
        // Under its .apk name before Android reads it: the archive parser
        // goes by the file name on some versions.
        if (!part.renameTo(apk)) throw IOException("could not keep the download")
        val archive = readArchive(apk)
        val verdict = UpdateRules.verify(archive, installed(), feed.sha256, hex)
        if (verdict != UpdateRules.Verdict.OK) {
            apk.delete()
            // A damaged transfer is tried again at the next check; only an
            // APK that can never go in is remembered.
            if (UpdateRules.isPermanent(verdict)) prefs().edit().putString(KEY_REJECTED, feed.version).apply()
            log.error("update.rejected", "downloaded ${feed.version} refused: $verdict", JSONObject().put("version", feed.version).put("verdict", verdict.name))
            set(Status.FAILED, latest = feed.version, error = when (verdict) {
                UpdateRules.Verdict.SIGNATURE_MISMATCH -> "This update is signed with a different key"
                else -> "The update didn't pass its checks"
            })
            return
        }
        val code = archive?.versionCode ?: 0L
        ready = Ready(feed.version, code, apk)
        prefs().edit()
            .putString(KEY_READY_VERSION, feed.version)
            .putLong(KEY_READY_CODE, code)
            .putString(KEY_READY_PATH, apk.path)
            .remove(KEY_REJECTED)
            .apply()
        log.info("update.ready", "update ${feed.version} downloaded and verified",
            JSONObject().put("version", feed.version).put("versionCode", code).put("ms", System.currentTimeMillis() - started))
        set(Status.READY, latest = feed.version)
    }

    // ── Installing ──────────────────────────────────────────────────────

    /** The person tapped Install, and waits for Ember to come back
     *  (UpdatedReceiver's "Ember updated" notice). */
    fun installNow() {
        GateHistory.installStarted(app)
        main.post { tap() }
    }

    /** Main thread. A person asked for the install (Install, or the gate's
     *  Update now). A session that is still alive is reused, never
     *  abandoned (UpdateRules.onTap). */
    private fun tap() {
        autoBlocked = false
        val confirm = pendingConfirm
        val alive = sessionAlive()
        val decision = UpdateRules.onTap(
            staging = busy.get() && status == Status.INSTALLING,
            alive = alive,
            sinceActivityMs = clock() - activityAt,
            confirmHeld = confirm != null,
            canShowConfirm = UpdatePresence.foreground && !carSession(),
        )
        val version = ready?.version ?: latest
        when (decision) {
            UpdateRules.Tap.RELAUNCH_CONFIRM -> if (confirm != null && launch(confirm)) {
                // Kept: a Back out of the screen can be followed by another tap.
                touch()
                log.info("update.reuse", "showing the confirm screen of session $sessionId again", JSONObject().put("sid", sessionId ?: -1).put("version", version))
                set(Status.INSTALLING, latest = version)
                armWatch()
                return
            }
            UpdateRules.Tap.WAIT -> {
                log.info("update.waiting", "install of $version still in progress, not starting another",
                    JSONObject().put("sid", sessionId ?: -1).put("version", version).put("alive", alive))
                if (status != Status.INSTALLING) set(Status.INSTALLING, latest = version)
                armWatch()
                return
            }
            UpdateRules.Tap.NEW_SESSION -> Unit
        }
        // Nothing to keep: back to "ready" so evaluate() may install again.
        if (status == Status.INSTALLING && !busy.get()) status = Status.READY
        evaluate(true)
    }

    /** Whether Android still has the session this app committed. */
    private fun sessionAlive(): Boolean {
        val id = sessionId ?: return false
        return runCatching { app.packageManager.packageInstaller.getSessionInfo(id) != null }.getOrDefault(false)
    }

    /** The session showed a sign of life. */
    private fun touch() {
        activityAt = clock()
        prefs().edit().putLong(KEY_ACTIVITY_AT, activityAt).apply()
    }

    /** Main thread. Whether the ready update installs now, and if not, what
     *  it waits for (shown on the page as `waiting`). */
    fun evaluate(userRequested: Boolean) {
        val r = ready ?: return
        if (status == Status.INSTALLING || busy.get()) return
        if (!r.file.exists()) { clearReady(); set(Status.IDLE); return }
        val facts = UpdateRules.InstallFacts(
            carSession = carSession(),
            userRequested = userRequested,
            canInstall = canInstall(),
        )
        val decision = UpdateRules.decide(facts)
        if (decision != lastDecision || userRequested) {
            lastDecision = decision
            val data = JSONObject().put("version", r.version).put("decision", decision.name)
                .put("playing", UpdatePresence.playing).put("car", facts.carSession).put("foreground", UpdatePresence.foreground).put("silent", silentLikely())
            if (decision == UpdateRules.Decision.INSTALL) log.info("update.install", "installing ${r.version}${if (userRequested) " (tapped)" else ""}", data)
            else log.info("update.deferred", "update ${r.version} waits: ${decision.name.lowercase()}", data)
        }
        when (decision) {
            UpdateRules.Decision.INSTALL -> install(r)
            UpdateRules.Decision.WAIT_CAR -> set(Status.READY, latest = r.version, waiting = "car")
            UpdateRules.Decision.ASK_USER -> set(Status.READY, latest = r.version, waiting = "tap", error = error.takeIf { autoBlocked })
            UpdateRules.Decision.NEED_PERMISSION -> set(Status.READY, latest = r.version, waiting = "permission")
        }
    }

    private fun install(r: Ready) {
        if (!busy.compareAndSet(false, true)) return
        // Decided before this attempt counts as a sign of life: the session
        // a new one must not abandon, if any (tap() normally waits for it).
        val keepId = sessionId?.takeIf { UpdateRules.sessionInProgress(sessionAlive(), clock() - activityAt) }
        installStartedAt = clock()
        touch()
        set(Status.INSTALLING, latest = r.version)
        prefs().edit().putString(KEY_INSTALLING, r.version).putLong(KEY_INSTALL_AT, installStartedAt).apply()
        pendingConfirm = null
        goneSince = 0L
        // Watched until Android answers (checkInstall).
        armWatch()
        // Installing replaces this process: send what is buffered first.
        log.flush()
        work.execute {
            try {
                // Copying the APK takes a moment: music started (a headset's
                // play key) or a car connected in the meantime still wins.
                val committed = UpdateInstaller.commit(app, r.file, silent = Build.VERSION.SDK_INT >= 31,
                    stillOk = { !carSession() }, committing = ::rememberSession,
                    keep = { id -> !UpdateRules.mayAbandon(id, keepId, keepId != null) })
                if (!committed) busy.set(false)
                if (!committed) main.post {
                    log.info("update.deferred", "install of ${r.version} called off: music or the car started")
                    main.removeCallbacks(watch)
                    prefs().edit().remove(KEY_INSTALLING).apply()
                    lastDecision = null
                    set(Status.READY, latest = r.version)
                    evaluate(false)
                }
            } catch (e: Exception) {
                onInstallNotStarted(e.message.orEmpty())
            } finally {
                busy.set(false)
            }
        }
    }

    private fun armWatch(ms: Long = UpdateRules.INSTALL_WATCH_MS) {
        main.removeCallbacks(watch)
        main.postDelayed(watch, ms)
    }

    /** Main thread. While INSTALLING: is the session still there? Android
     *  keeps it through its confirm screen, a vendor's security scan and Play
     *  Protect's check, however long the person takes; only when it is gone
     *  with no answer, or showed no sign of life for
     *  UpdateRules.INSTALL_BACKSTOP_MS, does the install end
     *  (UpdateRules.unstickNow). The same for the gate, the pill and
     *  Settings. */
    private fun checkInstall() {
        main.removeCallbacks(watch)
        if (status != Status.INSTALLING) return
        val now = clock()
        val staging = busy.get()
        val alive = sessionAlive()
        if (alive || staging) goneSince = 0L else if (goneSince == 0L) goneSince = now
        val goneFor = if (goneSince == 0L) 0L else now - goneSince
        val sinceActivity = now - activityAt
        if (UpdateRules.unstickNow(staging, alive, sinceActivity, goneFor)) unstick(alive, sinceActivity)
        else armWatch(if (goneSince != 0L) UpdateRules.SESSION_GONE_GRACE_MS else UpdateRules.INSTALL_WATCH_MS)
    }

    /** INSTALLING with no answer from Android: the session died quietly, or
     *  sat with no sign of life past the backstop. Back to "tap to install".
     *  The session id stays: a late answer still counts, and the next tap
     *  reuses a live session or replaces a stuck one (UpdateRules.onTap). */
    private fun unstick(alive: Boolean, sinceActivityMs: Long) {
        val r = ready ?: return
        main.removeCallbacks(watch)
        goneSince = 0L
        autoBlocked = true
        lastDecision = UpdateRules.Decision.ASK_USER
        val data = JSONObject().put("timeout", sinceActivityMs >= UpdateRules.INSTALL_BACKSTOP_MS).put("alive", alive)
            .put("sid", sessionId ?: -1).put("version", r.version).put("idleMs", sinceActivityMs)
        if (installStartedAt > 0) data.put("ms", clock() - installStartedAt)
        log.warn("update.unanswered", "no answer to the install of ${r.version}", data)
        log.flush()
        set(Status.READY, latest = r.version, waiting = "tap")
    }

    /** UpdateInstallReceiver: Android's answer for an install session. Every
     *  answer is logged with its status, message, session and how long the
     *  install has run, and sent at once: the process may be replaced or
     *  killed right after. */
    fun onAnswer(a: UpdateRules.Answer, confirm: Intent?) {
        if (!UpdateRules.isCurrentSession(sessionId, a.sessionId)) {
            log.info("update.stale", "answer for another install session ignored: ${UpdateRules.describeStatus(a.status, a.message)}",
                answerData(a, ready?.version).put("current", sessionId ?: -1))
            return
        }
        // Anything but "the person has to confirm" is the session's end.
        if (a.status != PackageInstaller.STATUS_PENDING_USER_ACTION) forgetSession() else touch()
        when (a.status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> onNeedsConfirm(a, confirm)
            PackageInstaller.STATUS_SUCCESS -> onInstalled(a)
            PackageInstaller.STATUS_FAILURE_ABORTED -> onInstallFailed(a, keep = true, aborted = true)
            // A different key or a broken file: the same APK can never go in.
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, PackageInstaller.STATUS_FAILURE_INVALID ->
                onInstallFailed(a, keep = false)
            else -> onInstallFailed(a, keep = true)
        }
    }

    private fun rememberSession(id: Int) {
        sessionId = id
        prefs().edit().putInt(KEY_SESSION, id).apply()
        touch()
    }

    private fun forgetSession() {
        sessionId = null
        prefs().edit().remove(KEY_SESSION).apply()
    }

    fun onEmptyAnswer(sessionId: Int) {
        log.info("update.answer", "install answer without a status, ignored", JSONObject().put("sid", sessionId))
    }

    /** What the log says about [a]: status, message, session id ("sid": a
     *  key with "session" in it is dropped by LogRedact), and the ms since
     *  the install began (kept across a restart). */
    private fun answerData(a: UpdateRules.Answer, version: String?): JSONObject {
        val o = JSONObject().put("status", a.status).put("message", a.message).put("sid", a.sessionId)
        version?.let { o.put("version", it) }
        a.legacy?.let { o.put("legacy", it) }
        val started = installStartedAt.takeIf { it > 0 } ?: prefs().getLong(KEY_INSTALL_AT, 0L)
        if (started > 0) o.put("ms", clock() - started)
        return o
    }

    /** The system needs the person to confirm. On screen, the confirm
     *  screen opens now; otherwise it waits for a tap. */
    private fun onNeedsConfirm(a: UpdateRules.Answer, confirm: Intent?) {
        main.post {
            val r = ready
            log.info("update.confirm", "Android asks to confirm ${r?.version}",
                answerData(a, r?.version).put("foreground", UpdatePresence.foreground).put("intent", confirm != null))
            log.flush()
            r ?: return@post
            pendingConfirm = confirm
            if (confirm != null && UpdatePresence.foreground && !carSession() && launch(confirm)) {
                set(Status.INSTALLING, latest = r.version)
                armWatch()
                return@post
            }
            // Android asked where a silent install was expected: no more
            // tries by itself (each would stage the whole APK again).
            autoBlocked = true
            main.removeCallbacks(watch)
            lastDecision = UpdateRules.Decision.ASK_USER
            set(Status.READY, latest = r.version, waiting = "tap")
        }
    }

    private fun onInstalled(a: UpdateRules.Answer) {
        log.info("update.installed", "update installed", answerData(a, ready?.version))
        log.flush()
    }

    /** Declined, or failed. [keep] leaves the APK for a tap to try again.
     *  A plain "no" on Android's screen is info; ABORTED for any other
     *  reason (Play Protect, a verifier) is a warning, so the daily digest
     *  counts it. */
    private fun onInstallFailed(a: UpdateRules.Answer, keep: Boolean, aborted: Boolean = false) {
        main.post {
            val r = ready
            val data = answerData(a, r?.version)
            val what = UpdateRules.describeStatus(a.status, a.message)
            prefs().edit().remove(KEY_INSTALLING).apply()
            main.removeCallbacks(watch)
            autoBlocked = true
            pendingConfirm = null
            when {
                aborted && UpdateRules.isPlainCancel(a.status, a.message) -> log.info("update.declined", "install of ${r?.version} not confirmed: $what", data)
                aborted -> log.warn("update.declined", "install of ${r?.version} stopped: $what", data)
                keep -> log.error("update.failed", "install failed: $what", data)
                else -> log.error("update.failed", "install refused: $what", data)
            }
            log.flush()
            if (r != null && keep) {
                lastDecision = UpdateRules.Decision.ASK_USER
                set(Status.READY, latest = r.version, waiting = "tap", error = if (aborted) null else "The update didn't install")
            } else {
                // The same APK can never go in: not again every 6 hours.
                r?.let { prefs().edit().putString(KEY_REJECTED, it.version).apply() }
                clearReady()
                set(Status.FAILED, error = "The update didn't install")
            }
        }
    }

    /** Staging or committing threw: no session answer will come. */
    private fun onInstallNotStarted(message: String) {
        forgetSession()
        main.post {
            val r = ready
            prefs().edit().remove(KEY_INSTALLING).apply()
            main.removeCallbacks(watch)
            autoBlocked = true
            pendingConfirm = null
            log.error("update.failed", "install could not start: $message", JSONObject().put("version", r?.version))
            log.flush()
            r ?: return@post
            lastDecision = UpdateRules.Decision.ASK_USER
            set(Status.READY, latest = r.version, waiting = "tap", error = "The update didn't install")
        }
    }

    private fun launch(confirm: Intent): Boolean {
        val a = activity?.get()
        return runCatching {
            if (a != null && !a.isFinishing) a.startActivity(confirm)
            else app.startActivity(Intent(confirm).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.isSuccess
    }

    /** Android's "Install unknown apps" screen for Ember. */
    fun openInstallSettings(from: Activity?): Boolean {
        if (Build.VERSION.SDK_INT < 26) return false
        val intent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${app.packageName}"))
        log.info("update.permission", "opening the install-unknown-apps setting")
        return runCatching {
            if (from != null) from.startActivity(intent) else app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.isSuccess
    }

    /** Back on screen: the permission may have changed in Settings, and the
     *  install session may have ended without an answer. Leaving Android's
     *  confirm screen is not an answer: Play Protect may still be checking. */
    fun refresh() {
        main.post {
            checkInstall()
            evaluate(false)
            publish()
        }
    }

    // ── Facts about the phone ───────────────────────────────────────────

    /** Android Auto projecting (car mode) or a car's media browser on the
     *  player. Not on an Android car (AAOS): its media centre is connected
     *  all the time there, so the car's rule reduces to "not while music
     *  plays", which UpdateRules applies anyway. */
    private fun carSession(): Boolean {
        if (Surfaces.isAutomotive(app)) return false
        return UpdatePresence.carConnected || Surfaces.isCarMode(app)
    }

    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < 26 || runCatching { app.packageManager.canRequestPackageInstalls() }.getOrDefault(false)

    private fun installerOfRecord(): String? = runCatching {
        if (Build.VERSION.SDK_INT >= 30) app.packageManager.getInstallSourceInfo(app.packageName).installingPackageName
        else @Suppress("DEPRECATION") app.packageManager.getInstallerPackageName(app.packageName)
    }.getOrNull()

    /** For the car's notice: whether the waiting update will go in by itself. */
    private fun silentLikely(): Boolean = UpdateRules.silentLikely(Build.VERSION.SDK_INT, installerOfRecord(), app.packageName)

    private fun netFacts(): UpdateRules.NetFacts? {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val caps = runCatching { cm.getNetworkCapabilities(cm.activeNetwork) }.getOrNull() ?: return null
        return UpdateRules.NetFacts(
            internet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
            validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
            cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
            ethernet = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
        )
    }

    private fun installedCode(): Long = runCatching {
        val info = app.packageManager.getPackageInfo(app.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    }.getOrDefault(0L)

    private fun installed(): UpdateRules.Installed {
        val (signers, _) = signers(installedInfo(certFlags()))
        val legacy = if (signers.isEmpty()) signers(installedInfo(legacyFlags())).first else signers
        return UpdateRules.Installed(installedCode(), legacy)
    }

    /** What the downloaded file says about itself; null when Android cannot
     *  read it as an APK. */
    private fun readArchive(file: File): UpdateRules.Archive? {
        val info = archiveInfo(file, certFlags()) ?: return null
        var (current, history) = signers(info)
        if (current.isEmpty()) {
            // Some Android versions leave signingInfo empty for an archive;
            // the old signatures field still has the certificate.
            current = archiveInfo(file, legacyFlags())?.let { signers(it).first }.orEmpty()
            history = emptySet()
        }
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        return UpdateRules.Archive(info.packageName, code, current, history)
    }

    private fun certFlags(): Int = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else legacyFlags()
    @Suppress("DEPRECATION")
    private fun legacyFlags(): Int = PackageManager.GET_SIGNATURES

    private fun installedInfo(flags: Int): PackageInfo? = runCatching {
        @Suppress("DEPRECATION") app.packageManager.getPackageInfo(app.packageName, flags)
    }.getOrNull()

    private fun archiveInfo(file: File, flags: Int): PackageInfo? = runCatching {
        @Suppress("DEPRECATION") app.packageManager.getPackageArchiveInfo(file.path, flags)
    }.getOrNull()

    /** (current signers, lineage) as SHA-256 hex of each certificate. */
    private fun signers(info: PackageInfo?): Pair<Set<String>, Set<String>> {
        info ?: return emptySet<String>() to emptySet()
        fun digest(sigs: Array<android.content.pm.Signature>?): Set<String> =
            sigs.orEmpty().map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
        if (Build.VERSION.SDK_INT >= 28) {
            val si = info.signingInfo
            if (si != null) {
                val current = digest(si.apkContentsSigners)
                val history = if (si.hasMultipleSigners()) emptySet() else digest(si.signingCertificateHistory)
                if (current.isNotEmpty()) return current to history
            }
        }
        @Suppress("DEPRECATION")
        return digest(info.signatures) to emptySet()
    }

    // ── Log ─────────────────────────────────────────────────────────────

    private fun buildLog(): PlaybackLog {
        val delay = Delay { ms, task ->
            val f = logTimer.schedule(task, ms, TimeUnit.MILLISECONDS)
            ({ f.cancel(false); Unit })
        }
        val automotive = Surfaces.isAutomotive(app)
        return PlaybackLog(
            send = { body ->
                // Signed out: nobody to file it under, and the server would
                // only answer 401. Same rule as the player's log.
                val cookie = runCatching { CookieManager.getInstance().getCookie(baseUrl) }.getOrNull()
                if (cookie.isNullOrBlank()) throw IOException("signed out")
                val req = Request.Builder().url("$baseUrl/api/native-log").header("Cookie", cookie)
                    .post(body.toString().toRequestBody("application/json".toMediaType())).build()
                http.newCall(req).execute().use { if (!it.isSuccessful) throw IOException("native-log -> ${it.code}") }
            },
            online = { UpdateRules.canDownload(netFacts()) },
            io = logIo,
            delay = delay,
            surface = { Surfaces.of(automotive, Surfaces.isCarMode(app), UpdatePresence.carConnected) },
            device = JSONObject()
                .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80))
                .put("sdk", Build.VERSION.SDK_INT)
                .put("app", AppVersion.name(app).orEmpty()),
        )
    }

}
