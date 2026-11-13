package app.ember.music

import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Looper
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.util.concurrent.Executor

/** The install itself, end to end on Robolectric's PackageInstaller: the
 *  updater stages a waiting APK in a session, and UpdateInstallReceiver's
 *  answers for that session drive what the page and the gate see and what
 *  the log says. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UpdateInstallFlowTest {
    private val app = RuntimeEnvironment.getApplication()
    private val installer get() = app.packageManager.packageInstaller
    private var now = 1_000_000L
    private lateinit var log: PlaybackLog

    @Before fun setUp() {
        UpdatePresence.reset()
        // Offline: every event stays in the buffer for the test to read.
        log = PlaybackLog(
            send = { throw IOException("offline") }, online = { false }, io = Executor { it.run() },
            delay = Delay { _, _ -> {} }, surface = { Surfaces.PHONE }, device = JSONObject(),
        )
        AppUpdater.resetForTest(log, Executor { it.run() }) { now }
        shadowOf(app.packageManager).setCanRequestPackageInstalls(true)
    }

    @After fun tearDown() {
        AppUpdater.resetForTest(null, Executor { it.run() })
        UpdatePresence.reset()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    /** A verified 9.9.9 waiting from an earlier run, then a fresh updater. */
    private fun readyApk(version: String = "9.9.9", dir: File = AppUpdater.updatesDir(app)): File {
        dir.mkdirs()
        val apk = File(dir, "ember-$version.apk").apply { writeBytes(ByteArray(4096) { it.toByte() }) }
        app.getSharedPreferences("ember.update", 0).edit()
            .putString("readyVersion", version).putLong("readyCode", Int.MAX_VALUE.toLong()).putString("readyPath", apk.path)
            .commit()
        AppUpdater.init(app)
        return apk
    }

    /** The person taps Install: one session committed. Its id. */
    private fun tapInstall(): Int {
        AppUpdater.installNow()
        idle()
        assertEquals(log.pending().toString() + AppUpdater.stateJson(), "installing", AppUpdater.stateJson().getString("status"))
        return installer.mySessions.single().sessionId
    }

    private fun answer(status: Int, message: String, sid: Int, legacy: Int? = null) {
        val i = Intent(UpdateInstaller.ACTION_STATUS)
            .putExtra(PackageInstaller.EXTRA_STATUS, status)
            .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, message)
            .putExtra(PackageInstaller.EXTRA_SESSION_ID, sid)
        legacy?.let { i.putExtra(UpdateInstallReceiver.EXTRA_LEGACY_STATUS, it) }
        UpdateInstallReceiver().onReceive(app, i)
        idle()
    }

    private fun events(name: String) = log.pending().filter { it.getString("event") == name }

    @Test fun `Play Protect stopping the install is logged with status, message, session and time, as a warning`() {
        readyApk()
        val sid = tapInstall()
        now += 42_000
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_VERIFICATION_FAILURE", sid, legacy = -22)
        val e = events("update.blocked").single()
        assertEquals("warn", e.getString("level"))
        assertTrue(e.getString("message"), e.getString("message").contains("aborted (3): INSTALL_FAILED_VERIFICATION_FAILURE"))
        val d = e.getJSONObject("data")
        assertEquals(3, d.getInt("status"))
        assertEquals("INSTALL_FAILED_VERIFICATION_FAILURE", d.getString("message"))
        assertEquals(sid, d.getInt("sid"))
        assertEquals(42_000L, d.getLong("ms"))
        assertEquals(-22, d.getInt("legacy"))
        assertEquals("9.9.9", d.getString("version"))
    }

    @Test fun `a plain no on Android's screen stays info`() {
        readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: User rejected permissions", sid)
        assertEquals("info", events("update.declined").single().getString("level"))
        assertEquals("ready", AppUpdater.stateJson().getString("status"))
    }

    @Test fun `every answer is logged, the confirm request and a failure too`() {
        readyApk()
        val sid = tapInstall()
        now += 5_000
        answer(PackageInstaller.STATUS_PENDING_USER_ACTION, "", sid)
        val confirm = events("update.confirm").single().getJSONObject("data")
        assertEquals(-1, confirm.getInt("status"))
        assertEquals(sid, confirm.getInt("sid"))
        assertEquals(5_000L, confirm.getLong("ms"))
        now += 1_000
        answer(PackageInstaller.STATUS_FAILURE_STORAGE, "INSTALL_FAILED_INSUFFICIENT_STORAGE", sid)
        val failed = events("update.failed").single()
        assertEquals("error", failed.getString("level"))
        assertEquals(6, failed.getJSONObject("data").getInt("status"))
        assertEquals(6_000L, failed.getJSONObject("data").getLong("ms"))
    }

    @Test fun `the install start time survives a restart, for the log`() {
        readyApk()
        val sid = tapInstall()
        assertEquals(now, app.getSharedPreferences("ember.update", 0).getLong("installStartedAt", 0))
        // The new version starts (the waiting APK is not newer any more) and
        // gets the answer.
        app.getSharedPreferences("ember.update", 0).edit().putLong("readyCode", 1L).commit()
        now += 90_000
        AppUpdater.resetForTest(log, Executor { it.run() }) { now }
        AppUpdater.init(app)
        answer(PackageInstaller.STATUS_SUCCESS, "INSTALL_SUCCEEDED", sid)
        val ok = events("update.installed").single().getJSONObject("data")
        assertEquals(90_000L, ok.getLong("ms"))
        assertEquals(sid, ok.getInt("sid"))
    }

    @Test fun `success while the old process still runs is logged once, not again by the new version`() {
        readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_SUCCESS, "INSTALL_SUCCEEDED", sid)
        app.getSharedPreferences("ember.update", 0).edit().putLong("readyCode", 1L).commit()
        AppUpdater.resetForTest(log, Executor { it.run() }) { now }
        AppUpdater.init(app)
        assertEquals(1, events("update.installed").size)
    }

    // ── Which session an answer is for ──────────────────────────────────

    private fun prefs() = app.getSharedPreferences("ember.update", 0)

    @Test fun `the committed session is remembered, across a restart too`() {
        readyApk()
        val sid = tapInstall()
        assertEquals(sid, prefs().getInt("installSession", -1))
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: User rejected permissions", sid)
        // A final answer ends it.
        assertFalse(prefs().contains("installSession"))
    }

    @Test fun `an answer for another session is ignored, and the held confirm screen stays`() {
        readyApk()
        UpdatePresence.setForeground(true)
        val sid = tapInstall()
        val confirm = Intent("android.content.pm.action.CONFIRM_INSTALL")
        answerConfirm(sid, confirm)
        assertEquals("installing", AppUpdater.stateJson().getString("status"))
        assertEquals(confirm.action, shadowOf(app).nextStartedActivity.action)
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: Session was abandoned", sid + 100)
        assertEquals("installing", AppUpdater.stateJson().getString("status"))
        assertEquals(1, events("update.stale").size)
        assertTrue(events("update.declined").isEmpty())
        // Still held: a tap opens the same confirm screen again.
        AppUpdater.installNow()
        idle()
        assertEquals(confirm.action, shadowOf(app).nextStartedActivity.action)
        assertEquals(sid, prefs().getInt("installSession", -1))
    }

    @Test fun `an abandoned attempt answering late does not end the next one`() {
        readyApk()
        val first = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: User rejected permissions", first)
        assertEquals("ready", AppUpdater.stateJson().getString("status"))
        AppUpdater.installNow()
        idle()
        val second = installer.mySessions.single().sessionId
        assertTrue(second != first)
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: Session was abandoned", first)
        assertEquals("installing", AppUpdater.stateJson().getString("status"))
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: User rejected permissions", second)
        assertEquals("ready", AppUpdater.stateJson().getString("status"))
    }

    private fun answerConfirm(sid: Int, confirm: Intent) {
        UpdateInstallReceiver().onReceive(app, Intent(UpdateInstaller.ACTION_STATUS)
            .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
            .putExtra(PackageInstaller.EXTRA_SESSION_ID, sid)
            .putExtra(Intent.EXTRA_INTENT, confirm))
        idle()
    }

    // ── Never abandoning a session in progress ──────────────────────────

    private fun restart() {
        AppUpdater.resetForTest(log, Executor { it.run() }) { now }
        AppUpdater.init(app)
    }

    @Test fun `a tap while the committed session is still being checked starts nothing new`() {
        readyApk()
        val sid = tapInstall()
        now += 3 * 60_000 // Play Protect is scanning; meanwhile the process went.
        restart()
        AppUpdater.installNow()
        idle()
        assertEquals("installing", AppUpdater.stateJson().getString("status"))
        assertEquals(listOf(sid), installer.mySessions.map { it.sessionId })
        assertEquals(1, events("update.waiting").size)
    }

    @Test fun `a tap shows the held confirm screen again instead of staging a new session`() {
        readyApk()
        UpdatePresence.setForeground(true)
        val sid = tapInstall()
        val confirm = Intent("android.content.pm.action.CONFIRM_INSTALL")
        answerConfirm(sid, confirm)
        shadowOf(app).nextStartedActivity
        AppUpdater.installNow()
        idle()
        assertEquals(confirm.action, shadowOf(app).nextStartedActivity.action)
        assertEquals(listOf(sid), installer.mySessions.map { it.sessionId })
        assertEquals(1, events("update.reuse").size)
    }

    @Test fun `a leftover session nobody committed is cleaned up by the next install`() {
        val leftover = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
        readyApk()
        val sid = tapInstall()
        assertTrue(sid != leftover)
        assertNull(installer.getSessionInfo(leftover))
    }

    @Test fun `a committed session stuck past the backstop is replaced on the next tap`() {
        readyApk()
        val stuck = tapInstall()
        now += UpdateRules.INSTALL_BACKSTOP_MS + 1
        restart()
        AppUpdater.installNow()
        idle()
        val fresh = installer.mySessions.single().sessionId
        assertTrue(fresh != stuck)
        assertNull(installer.getSessionInfo(stuck))
        assertEquals(fresh, prefs().getInt("installSession", -1))
    }

    // ── Waiting for as long as the session lives ────────────────────────

    private fun idleFor(ms: Long) {
        now += ms
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(ms))
    }

    private fun status() = AppUpdater.stateJson().getString("status")

    @Test fun `a live session keeps Installing well past a minute, through resumes and the watch`() {
        readyApk()
        tapInstall()
        idleFor(5 * 60_000)
        AppUpdater.refresh()
        idle()
        assertEquals("installing", status())
        assertTrue(events("update.unanswered").isEmpty())
    }

    @Test fun `Settings no longer drops back to tap to install on the resume after the confirm screen`() {
        readyApk()
        UpdatePresence.setForeground(true)
        val sid = tapInstall()
        answerConfirm(sid, Intent("android.content.pm.action.CONFIRM_INSTALL"))
        // Back from the confirm screen into Play Protect's check: a resume.
        AppUpdater.refresh()
        idle()
        assertEquals("installing", status())
    }

    @Test fun `a session gone with no answer ends the install after the grace, as a warning`() {
        readyApk()
        val sid = tapInstall()
        installer.abandonSession(sid)
        AppUpdater.refresh()
        idle()
        assertEquals("installing", status())
        idleFor(UpdateRules.SESSION_GONE_GRACE_MS)
        assertEquals("ready", status())
        assertEquals("tap", AppUpdater.stateJson().getString("waiting"))
        val e = events("update.unanswered").single()
        assertEquals("warn", e.getString("level"))
        assertFalse(e.getJSONObject("data").getBoolean("timeout"))
        assertFalse(e.getJSONObject("data").getBoolean("alive"))
    }

    @Test fun `the backstop ends a session with no sign of life`() {
        readyApk()
        tapInstall()
        idleFor(UpdateRules.INSTALL_BACKSTOP_MS)
        assertEquals("ready", status())
        val d = events("update.unanswered").single().getJSONObject("data")
        assertTrue(d.getBoolean("timeout"))
        assertTrue(d.getBoolean("alive"))
    }

    @Test fun `a confirm request counts as a sign of life for the backstop`() {
        readyApk()
        val sid = tapInstall()
        idleFor(UpdateRules.INSTALL_BACKSTOP_MS - 60_000)
        answer(PackageInstaller.STATUS_PENDING_USER_ACTION, "", sid)
        // Not on screen, so it waits for a tap; a tap shows nothing new
        // (no confirm intent) and keeps waiting on the live session.
        AppUpdater.installNow()
        idle()
        idleFor(2 * 60_000)
        assertEquals("installing", status())
    }

    // ── What each answer does to the waiting APK ────────────────────────

    private fun rejected() = AppUpdater.rejectedVersion()

    @Test fun `Play Protect's block keeps the APK and says how to get past it`() {
        val apk = readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_VERIFICATION_FAILURE", sid, legacy = -22)
        val st = AppUpdater.stateJson()
        assertEquals("ready", st.getString("status"))
        assertEquals("tap", st.getString("waiting"))
        assertTrue(st.getString("error").contains("More details, then Install anyway"))
        assertTrue(apk.exists())
        assertNull(rejected())
        assertEquals("play_protect", events("update.blocked").single().getJSONObject("data").getString("outcome"))
    }

    @Test fun `Xiaomi's USER_RESTRICTED never refuses the version or deletes the APK`() {
        val apk = readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, "INSTALL_FAILED_USER_RESTRICTED: Install canceled by user", sid, legacy = -111)
        assertTrue(apk.exists())
        assertNull(rejected())
        assertNull(app.getSharedPreferences("ember.update", 0).getString("rejectedVersion", null))
        val st = AppUpdater.stateJson()
        assertEquals("ready", st.getString("status"))
        assertEquals(AppUpdater.PHONE_BLOCKED_ERROR, st.getString("error"))
        assertEquals("warn", events("update.blocked").single().getString("level"))
        // And a tap tries again with the same APK.
        AppUpdater.installNow()
        idle()
        assertEquals("installing", status())
    }

    @Test fun `INCOMPATIBLE with no real incompatibility behind it keeps the APK`() {
        val apk = readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, "", sid)
        assertTrue(apk.exists())
        assertNull(rejected())
        assertEquals("ready", status())
    }

    @Test fun `another signing key refuses the version for good and drops the APK`() {
        val apk = readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_CONFLICT,
            "INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package app.ember.music signatures do not match previously installed version; ignoring!", sid)
        assertFalse(apk.exists())
        assertEquals("9.9.9", rejected())
        assertEquals("failed", status())
        assertEquals("error", events("update.failed").single().getString("level"))
    }

    @Test fun `an unreadable APK is dropped to download again, without refusing the version`() {
        val apk = readyApk()
        val sid = tapInstall()
        answer(PackageInstaller.STATUS_FAILURE_INVALID, "INSTALL_PARSE_FAILED_NOT_APK: Failed to parse", sid)
        assertFalse(apk.exists())
        assertNull(rejected())
        assertEquals("failed", status())
    }

    // ── After the process died ──────────────────────────────────────────

    @Test fun `a restart during a live install comes back on Installing`() {
        readyApk()
        val sid = tapInstall()
        now += 2 * 60_000
        restart()
        assertEquals("installing", status())
        assertEquals(sid, events("update.resumed").single().getJSONObject("data").getInt("sid"))
        // The gate's install request waits on that session too.
        UpdatePresence.setForeground(true)
        AppUpdater.installNow()
        idle()
        assertEquals(listOf(sid), installer.mySessions.map { it.sessionId })
        // Its answer is still matched after the restart.
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: User rejected permissions", sid)
        assertEquals("ready", status())
    }

    @Test fun `a restored install whose session then goes is ended by the watch`() {
        readyApk()
        val sid = tapInstall()
        restart()
        assertEquals("installing", status())
        installer.abandonSession(sid)
        idleFor(UpdateRules.INSTALL_WATCH_MS)
        idleFor(UpdateRules.SESSION_GONE_GRACE_MS)
        assertEquals("ready", status())
    }

    @Test fun `a restart after the session is gone or stuck comes back on ready`() {
        readyApk()
        val sid = tapInstall()
        installer.abandonSession(sid)
        restart()
        assertEquals("ready", status())
        // Stuck past the backstop: ready too.
        AppUpdater.installNow()
        idle()
        assertEquals("installing", status())
        now += UpdateRules.INSTALL_BACKSTOP_MS
        restart()
        assertEquals("ready", status())
    }

    @Test fun `an update that went in clears the session it came from`() {
        readyApk()
        tapInstall()
        // The new version starts: the waiting APK is not newer any more.
        prefs().edit().putLong("readyCode", 1L).commit()
        restart()
        assertFalse(prefs().contains("installSession"))
        assertFalse(prefs().contains("installActivityAt"))
    }

    // ── Where the APK waits ─────────────────────────────────────────────

    @Test fun `the ready APK waits outside the cache, in storage that is not backed up`() {
        val dir = AppUpdater.updatesDir(app)
        assertEquals(File(app.noBackupFilesDir, "updates"), dir)
        assertFalse(dir.path.startsWith(app.cacheDir.path))
    }

    @Test fun `a wiped cache does not lose the ready update`() {
        readyApk()
        app.cacheDir.deleteRecursively()
        restart()
        assertEquals("9.9.9", AppUpdater.readyVersion())
        assertEquals("ready", status())
    }

    @Test fun `an APK waiting in the old cache folder moves out of it`() {
        val legacy = File(app.cacheDir, "updates")
        val old = readyApk(dir = legacy)
        assertEquals("9.9.9", AppUpdater.readyVersion())
        val moved = File(AppUpdater.updatesDir(app), old.name)
        assertTrue(moved.exists())
        assertFalse(legacy.exists())
        assertEquals(moved.path, prefs().getString("readyPath", null))
        // And it still installs from there.
        tapInstall()
    }

    @Test fun `older downloads and broken parts are cleaned, the ready one stays`() {
        val dir = AppUpdater.updatesDir(app).apply { mkdirs() }
        val older = File(dir, "ember-9.9.8.apk").apply { writeText("x") }
        val part = File(dir, "ember-9.9.9.apk.part").apply { writeText("x") }
        val legacyOld = File(File(app.cacheDir, "updates").apply { mkdirs() }, "ember-9.9.7.apk").apply { writeText("x") }
        val apk = readyApk()
        assertTrue(apk.exists())
        assertFalse(older.exists())
        assertFalse(part.exists())
        assertFalse(legacyOld.exists())
    }

    // ── Edges ───────────────────────────────────────────────────────────

    @Test fun `a confirm screen asked for off screen and lost with the process does not pin Installing`() {
        readyApk()
        val sid = tapInstall()
        // Ember is off screen: the confirm is held for a tap...
        answerConfirm(sid, Intent("android.content.pm.action.CONFIRM_INSTALL"))
        assertEquals("ready", status())
        // ...and the process dies with it.
        restart()
        assertEquals("ready", status())
        UpdatePresence.setForeground(true)
        AppUpdater.installNow()
        idle()
        val fresh = installer.mySessions.single().sessionId
        assertTrue(fresh != sid)
        assertEquals("installing", status())
    }

    @Test fun `success reaching the new version's process is logged as installed`() {
        readyApk()
        val sid = tapInstall()
        // The new version starts: its restore() already cleaned up.
        prefs().edit().putLong("readyCode", 1L).commit()
        restart()
        answer(PackageInstaller.STATUS_SUCCESS, "INSTALL_SUCCEEDED", sid)
        assertTrue(events("update.stale").isEmpty())
        // Logged once, by the new version's start.
        assertEquals(sid, events("update.installed").single().getJSONObject("data").getInt("sid"))
    }

    @Test fun `the abandoned session's answer during the next staging is stale, not the new install's end`() {
        val apk = readyApk()
        val stuck = tapInstall()
        now += UpdateRules.INSTALL_BACKSTOP_MS + 1
        restart()
        // Staging runs later: hold it to answer in between.
        val queued = mutableListOf<Runnable>()
        AppUpdater.work = Executor { queued.add(it) }
        AppUpdater.installNow()
        idle()
        assertEquals("installing", status())
        assertEquals(1, queued.size)
        // Android answers the abandoned session while the new one stages.
        answer(PackageInstaller.STATUS_FAILURE_ABORTED, "INSTALL_FAILED_ABORTED: Session was abandoned", stuck, legacy = -115)
        assertEquals("installing", status())
        assertEquals(1, events("update.stale").size)
        assertTrue(events("update.declined").isEmpty())
        assertTrue(events("update.blocked").isEmpty())
        assertTrue(events("update.failed").isEmpty())
        assertNull(rejected())
        assertTrue(apk.exists())
        assertEquals("9.9.9", prefs().getString("installingVersion", null))
        // The staging finishes: the new session is the current one.
        queued.removeAt(0).run()
        idle()
        val fresh = installer.mySessions.single().sessionId
        assertTrue(fresh != stuck)
        assertEquals(fresh, prefs().getInt("installSession", -1))
        assertEquals("installing", status())
        // And a restart after that comes back on Installing for it.
        restart()
        assertEquals("installing", status())
    }
}
