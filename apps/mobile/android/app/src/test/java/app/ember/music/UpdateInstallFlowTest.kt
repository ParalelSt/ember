package app.ember.music

import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Looper
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    private fun readyApk(version: String = "9.9.9"): File {
        val dir = File(app.cacheDir, "updates").apply { mkdirs() }
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
        val e = events("update.declined").single()
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
        // A new process gets the answer.
        AppUpdater.resetForTest(log, Executor { it.run() }) { now }
        AppUpdater.init(app)
        now += 90_000
        answer(PackageInstaller.STATUS_SUCCESS, "INSTALL_SUCCEEDED", sid)
        val ok = events("update.installed").last().getJSONObject("data")
        assertEquals(90_000L, ok.getLong("ms"))
        assertFalse(ok.has("legacy"))
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
}
