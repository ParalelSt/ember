package app.ember.music

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

/** "Open Ember when this device starts" (BootStart, BootReceiver): off by
 *  default, the receiver only enabled while it is on, and at boot the
 *  player resumes the saved queue (paused, or playing with "and keep
 *  playing") and the app is asked to open. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BootStartTest {
    private val app = RuntimeEnvironment.getApplication()
    private val prefs = app.getSharedPreferences(BootStart.NAME, Context.MODE_PRIVATE)
    private val savedFile get() = File(app.filesDir, SavedQueue.FILE_NAME)
    private val receiver = ComponentName(app, BootReceiver::class.java)

    @Before fun setUp() {
        prefs.edit().clear().commit()
        savedFile.delete()
    }

    @After fun tearDown() {
        savedFile.delete()
    }

    private fun boot(action: String = Intent.ACTION_BOOT_COMPLETED) = BootReceiver().onReceive(app, Intent(action))
    private fun saveQueue() = SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(JSONObject("""{"id":"a","title":"A","artist":"B","durationSec":120}""")), 0, 0))
    private fun notices() = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications

    // ── The setting ────────────────────────────────────────────────────

    @Test fun `off by default, and so is keep playing`() {
        assertEquals(BootStart.Settings(enabled = false, keepPlaying = false), BootStart.load(prefs))
    }

    @Test fun `the receiver is disabled in the manifest and follows the setting`() {
        val pm = app.packageManager
        assertFalse(pm.getReceiverInfo(receiver, PackageManager.MATCH_DISABLED_COMPONENTS).enabled)
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = true))
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, pm.getComponentEnabledSetting(receiver))
        assertEquals(BootStart.Settings(enabled = true, keepPlaying = true), BootStart.load(prefs))
        BootStart.save(app, BootStart.Settings(enabled = false, keepPlaying = true))
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, pm.getComponentEnabledSetting(receiver))
        assertFalse(BootStart.load(prefs).enabled)
    }

    @Test fun `a locked boot and the boot after it are one start, a new boot is another`() {
        assertTrue(BootStart.isNewStart(1_000_000, 20_000, null, null))
        // LOCKED_BOOT_COMPLETED at 20 s, BOOT_COMPLETED at 25 s.
        assertFalse(BootStart.isNewStart(1_000_000, 25_000, 1_000_000, 20_000))
        // The wall clock set by the network meanwhile is still the same boot.
        assertFalse(BootStart.isNewStart(1_004_000, 30_000, 1_000_000, 20_000))
        // A quick boot (resume from the head unit's sleep) much later.
        assertTrue(BootStart.isNewStart(1_000_000, 3_600_000, 1_000_000, 20_000))
        // A real reboot soon after: another boot time.
        assertTrue(BootStart.isNewStart(1_200_000, 20_000, 1_000_000, 20_000))
    }

    @Test fun `only boot actions count`() {
        assertTrue(BootStart.isStartAction(Intent.ACTION_BOOT_COMPLETED))
        assertTrue(BootStart.isStartAction(Intent.ACTION_LOCKED_BOOT_COMPLETED))
        assertTrue(BootStart.isStartAction("android.intent.action.QUICKBOOT_POWERON"))
        assertFalse(BootStart.isStartAction(Intent.ACTION_MY_PACKAGE_REPLACED))
        assertFalse(BootStart.isStartAction(null))
    }

    @Test fun `the player may start at boot up to Android 14, not on 15`() {
        assertTrue(BootStart.canStartPlayerAtBoot(29))
        assertTrue(BootStart.canStartPlayerAtBoot(34))
        assertFalse(BootStart.canStartPlayerAtBoot(35))
    }

    // ── The receiver ───────────────────────────────────────────────────

    @Test fun `with the setting off a boot starts nothing`() {
        saveQueue()
        boot()
        assertNull(shadowOf(app).nextStartedService)
        assertNull(shadowOf(app).nextStartedActivity)
        assertTrue(notices().isEmpty())
    }

    @Test fun `a boot resumes the saved queue paused and opens the app`() {
        saveQueue()
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = false))
        boot()
        val started = shadowOf(app).nextStartedService
        assertNotNull(started)
        assertEquals(EmberPlaybackService::class.java.name, started!!.component?.className)
        assertEquals(EmberPlaybackService.ACTION_BOOT_RESUME, started.action)
        assertFalse(started.getBooleanExtra(EmberPlaybackService.EXTRA_PLAY, true))
        val opened = shadowOf(app).nextStartedActivity
        assertNotNull(opened)
        assertEquals(app.packageName, opened!!.component?.packageName)
        assertTrue(opened.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        // The player's own notification opens the app.
        assertTrue(notices().isEmpty())
    }

    @Test fun `and keep playing plays it`() {
        saveQueue()
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = true))
        boot()
        assertTrue(shadowOf(app).nextStartedService!!.getBooleanExtra(EmberPlaybackService.EXTRA_PLAY, false))
    }

    @Test fun `a locked boot then the boot start everything once`() {
        saveQueue()
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = true))
        boot(Intent.ACTION_LOCKED_BOOT_COMPLETED)
        boot(Intent.ACTION_BOOT_COMPLETED)
        assertNotNull(shadowOf(app).nextStartedService)
        assertNull(shadowOf(app).nextStartedService)
        assertNotNull(shadowOf(app).nextStartedActivity)
        assertNull(shadowOf(app).nextStartedActivity)
    }

    @Test fun `other broadcasts start nothing even with the setting on`() {
        saveQueue()
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = true))
        boot(Intent.ACTION_MY_PACKAGE_REPLACED)
        assertNull(shadowOf(app).nextStartedService)
        assertNull(shadowOf(app).nextStartedActivity)
    }

    @Test fun `with nothing saved the player is left alone and a notification offers the app`() {
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = true))
        boot()
        assertNull(shadowOf(app).nextStartedService)
        assertNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(1, notices().size)
    }

    @Config(sdk = [35])
    @Test fun `on Android 15 the player is not started from the boot, the app is offered instead`() {
        saveQueue()
        BootStart.save(app, BootStart.Settings(enabled = true, keepPlaying = true))
        boot()
        assertNull(shadowOf(app).nextStartedService)
        assertNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(1, notices().size)
    }
}
