package app.ember.music

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
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
    /** Larger than any Ember APK will be; a server answering more is wrong. */
    private const val MAX_APK_BYTES = 300L * 1024 * 1024
    private const val STUCK_INSTALL_MS = 60_000L

    enum class Status(val wire: String) {
        IDLE("idle"), CHECKING("checking"), UP_TO_DATE("up-to-date"), DOWNLOADING("downloading"),
        READY("ready"), INSTALLING("installing"), FAILED("failed"),
    }

    data class Ready(val version: String, val versionCode: Long, val file: File)

    private lateinit var app: Context
    private var baseUrl = ""
    private val work = Executors.newSingleThreadExecutor()
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
    /** Whether this run opened Android's confirm screen; coming back from
     *  it without an answer arrives as a plain resume. */
    @Volatile private var confirmShown = false
    private val stuckCheck = Runnable { unstick(force = true) }
    /** The system's confirm screen for a session that needs the person. */
    @Volatile private var pendingConfirm: Intent? = null
    /** The person said no (or the install failed) this run: no more tries
     *  by itself until they tap. */
    @Volatile private var autoBlocked = false
    /** When the current install began; a confirm screen left without an
     *  answer must not leave the page on "Installing" for ever. */
    @Volatile private var installStartedAt = 0L
    private var activity: WeakReference<Activity>? = null
    private var lastDecision: UpdateRules.Decision? = null
    private val idleCheck = Runnable { evaluate(false) }

    @Synchronized
    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        baseUrl = ServerConfig.baseUrl(app)
        log = buildLog()
        restore()
        UpdatePresence.onChange = { main.post { evaluate(false) } }
        runCatching { UpdateCheckJob.schedule(app) }.onFailure { log.warn("update.schedule", "periodic check not scheduled: ${it.message}") }
    }

    fun isReady(): Boolean = ready != null && status != Status.INSTALLING

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
        if (!manual && prefs().getString(KEY_REJECTED, null) == feed.version) {
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

    /** The person tapped Install. */
    fun installNow() {
        main.post {
            autoBlocked = false
            val confirm = pendingConfirm
            if (confirm != null && UpdatePresence.foreground && !carSession() && launch(confirm)) {
                // Kept: a Back out of the screen can be followed by another tap.
                confirmShown = true
                set(Status.INSTALLING, latest = ready?.version ?: latest)
                main.removeCallbacks(stuckCheck)
                main.postDelayed(stuckCheck, STUCK_INSTALL_MS)
                return@post
            }
            evaluate(true)
        }
    }

    /** Main thread. Whether the ready update installs now, and if not, what
     *  it waits for (shown on the page as `waiting`). */
    fun evaluate(userRequested: Boolean) {
        main.removeCallbacks(idleCheck)
        val r = ready ?: return
        if (status == Status.INSTALLING || busy.get()) return
        if (!r.file.exists()) { clearReady(); set(Status.IDLE); return }
        val facts = UpdateRules.InstallFacts(
            playing = UpdatePresence.playing,
            carSession = carSession(),
            foreground = UpdatePresence.foreground,
            idleMs = UpdatePresence.idleMs(),
            userRequested = userRequested,
            silentLikely = silentLikely(),
            canInstall = canInstall(),
        )
        var decision = UpdateRules.decide(facts)
        if (decision == UpdateRules.Decision.INSTALL && autoBlocked && !userRequested) decision = UpdateRules.Decision.ASK_USER
        if (decision != lastDecision || userRequested) {
            lastDecision = decision
            val data = JSONObject().put("version", r.version).put("decision", decision.name)
                .put("playing", facts.playing).put("car", facts.carSession).put("foreground", facts.foreground).put("silent", facts.silentLikely)
            if (decision == UpdateRules.Decision.INSTALL) log.info("update.install", "installing ${r.version}${if (userRequested) " (tapped)" else ""}", data)
            else log.info("update.deferred", "update ${r.version} waits: ${decision.name.lowercase()}", data)
        }
        when (decision) {
            UpdateRules.Decision.INSTALL -> install(r, userRequested)
            UpdateRules.Decision.WAIT_CAR -> set(Status.READY, latest = r.version, waiting = "car")
            UpdateRules.Decision.WAIT_PLAYING -> set(Status.READY, latest = r.version, waiting = "playback")
            UpdateRules.Decision.WAIT_IDLE -> {
                set(Status.READY, latest = r.version, waiting = "idle")
                val left = (UpdateRules.IDLE_GRACE_MS - facts.idleMs).coerceIn(1_000L, UpdateRules.IDLE_GRACE_MS)
                main.postDelayed(idleCheck, left + 500)
            }
            UpdateRules.Decision.ASK_USER -> set(Status.READY, latest = r.version, waiting = "tap", error = error.takeIf { autoBlocked })
            UpdateRules.Decision.NEED_PERMISSION -> set(Status.READY, latest = r.version, waiting = "permission")
        }
    }

    private fun install(r: Ready, userRequested: Boolean) {
        if (!busy.compareAndSet(false, true)) return
        installStartedAt = System.currentTimeMillis()
        set(Status.INSTALLING, latest = r.version)
        prefs().edit().putString(KEY_INSTALLING, r.version).apply()
        pendingConfirm = null
        // A session that never got an answer is cleaned up after a while.
        main.removeCallbacks(stuckCheck)
        main.postDelayed(stuckCheck, STUCK_INSTALL_MS)
        // Installing replaces this process: send what is buffered first.
        log.flush()
        work.execute {
            try {
                // Copying the APK takes a moment: music started (a headset's
                // play key) or a car connected in the meantime still wins.
                val committed = UpdateInstaller.commit(app, r.file, silent = Build.VERSION.SDK_INT >= 31) {
                    !carSession() && (userRequested || !UpdatePresence.playing)
                }
                if (!committed) busy.set(false)
                if (!committed) main.post {
                    log.info("update.deferred", "install of ${r.version} called off: music or the car started")
                    main.removeCallbacks(stuckCheck)
                    prefs().edit().remove(KEY_INSTALLING).apply()
                    lastDecision = null
                    set(Status.READY, latest = r.version)
                    evaluate(false)
                }
            } catch (e: Exception) {
                main.post { onInstallFailed("install could not start: ${e.message}", keep = true) }
            } finally {
                busy.set(false)
            }
        }
    }

    /** INSTALLING with no answer from Android: the confirm screen was left
     *  without a choice, or the session died quietly. Back to "tap to
     *  install" ([force]: the timeout; otherwise only after a confirm screen
     *  this run opened). */
    private fun unstick(force: Boolean) {
        val r = ready ?: return
        if (status != Status.INSTALLING) return
        if (!force && !confirmShown) return
        confirmShown = false
        main.removeCallbacks(stuckCheck)
        autoBlocked = true
        lastDecision = UpdateRules.Decision.ASK_USER
        log.info("update.unanswered", "no answer to the install of ${r.version}", JSONObject().put("timeout", force))
        set(Status.READY, latest = r.version, waiting = "tap")
    }

    /** UpdateInstallReceiver: the system needs the person to confirm. On
     *  screen, the confirm screen opens now; otherwise it waits for a tap. */
    fun onNeedsConfirm(confirm: Intent?) {
        main.post {
            val r = ready ?: return@post
            log.info("update.confirm", "Android asks to confirm ${r.version}", JSONObject().put("foreground", UpdatePresence.foreground))
            pendingConfirm = confirm
            if (confirm != null && UpdatePresence.foreground && !carSession() && launch(confirm)) {
                confirmShown = true
                set(Status.INSTALLING, latest = r.version)
                return@post
            }
            // Android asked where a silent install was expected: no more
            // tries by itself (each would stage the whole APK again).
            autoBlocked = true
            main.removeCallbacks(stuckCheck)
            lastDecision = UpdateRules.Decision.ASK_USER
            set(Status.READY, latest = r.version, waiting = "tap")
        }
    }

    fun onInstalled() {
        log.info("update.installed", "update installed")
        log.flush()
    }

    /** Declined, or failed. [keep] leaves the APK for a tap to try again. */
    fun onInstallFailed(message: String, keep: Boolean, aborted: Boolean = false) {
        main.post {
            val r = ready
            prefs().edit().remove(KEY_INSTALLING).apply()
            main.removeCallbacks(stuckCheck)
            confirmShown = false
            autoBlocked = true
            pendingConfirm = null
            if (aborted) log.info("update.declined", "install of ${r?.version} not confirmed")
            else log.error("update.failed", message, JSONObject().put("version", r?.version))
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

    /** Back on screen: the permission may have changed in Settings, and a
     *  confirm screen may have been left with Back (no answer arrives then). */
    fun refresh() {
        main.post {
            unstick(force = status == Status.INSTALLING && System.currentTimeMillis() - installStartedAt > STUCK_INSTALL_MS)
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
    fun installsSilently(): Boolean = ::app.isInitialized && silentLikely()

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
