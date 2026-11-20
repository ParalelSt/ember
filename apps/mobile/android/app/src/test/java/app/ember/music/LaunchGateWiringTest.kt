package app.ember.music

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.io.File

/** How a launch reaches the app now that the launch gate is gone (owner,
 *  2026-11-14: no required updates; every update starts from a tap in the
 *  page). The home screen icon still opens LaunchGateActivity under its old
 *  component name, and it hands every start straight to the app: no update
 *  check, no dialog. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LaunchGateWiringTest {
    private val app = RuntimeEnvironment.getApplication()

    @Before fun setUp() = UpdatePresence.reset()
    @After fun tearDown() = UpdatePresence.reset()

    @Test fun `the icon still opens app_ember_music_MainActivity`() {
        val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)
        assertNotNull("no launcher entry", launch)
        assertEquals("${app.packageName}.MainActivity", launch!!.component!!.className)
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(Regex("""<activity-alias\s+android:name="\.MainActivity"\s+android:targetActivity="\.LaunchGateActivity"""").containsMatchIn(manifest))
    }

    @Test fun `the app and the trampoline themselves are private, the relaunch receiver too`() {
        val pm = app.packageManager
        assertFalse(pm.getActivityInfo(ComponentName(app, EmberActivity::class.java), 0).exported)
        assertFalse(pm.getActivityInfo(ComponentName(app, LaunchGateActivity::class.java), 0).exported)
        assertFalse(pm.getReceiverInfo(ComponentName(app, UpdatedReceiver::class.java), 0).exported)
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.intent.action.MY_PACKAGE_REPLACED"))
    }

    @Test fun `a launcher tap goes straight into the app, with no update check and no dialog`() {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClass(app, LaunchGateActivity::class.java)
        val gate = Robolectric.buildActivity(LaunchGateActivity::class.java, intent).create().get()
        // At once, in onCreate: nothing waited on a network answer.
        val next = shadowOf(gate).nextStartedActivity
        assertEquals(EmberActivity::class.java.name, next.component!!.className)
        assertEquals(Intent.ACTION_MAIN, next.action)
        assertTrue(gate.isFinishing)
        // Nothing else was started later (a dialog, a second activity).
        ShadowLooper.idleMainLooper()
        assertNull(shadowOf(gate).nextStartedActivity)
        val src = File("src/main/java/app/ember/music/LaunchGateActivity.kt").readText()
        for (gone in listOf("/api/app/update", "OkHttpClient", "Restarting in", "Quit Ember", "Not now", "installFromGate")) {
            assertFalse("LaunchGateActivity still has $gone", src.contains(gone))
        }
    }

    @Test fun `any other start is handed over the same way, its action and data kept`() {
        val intent = Intent(app, LaunchGateActivity::class.java).setAction(Intent.ACTION_VIEW)
        val gate = Robolectric.buildActivity(LaunchGateActivity::class.java, intent).create().get()
        val next = shadowOf(gate).nextStartedActivity
        assertEquals(EmberActivity::class.java.name, next.component!!.className)
        assertEquals(Intent.ACTION_VIEW, next.action)
        assertTrue(gate.isFinishing)
    }

    @Test fun `the first start after an update is told, once`() {
        assertEquals("0.4.33", GateHistory.wasUpdated("0.4.33", "0.4.34"))
        assertNull(GateHistory.wasUpdated("0.4.34", "0.4.34"))
        assertNull(GateHistory.wasUpdated(null, "0.4.34"))
        assertNull(GateHistory.wasUpdated("0.4.35", "0.4.34"))
        // On the device: the first call notes the running version, so a
        // second start of the same version says nothing.
        GateHistory.updatedFrom(app)
        assertNull(GateHistory.updatedFrom(app))
    }

    @Test fun `notifications are asked for right before an install the person waits on`() {
        val plugin = File("src/main/java/app/ember/music/EmberUpdatePlugin.kt").readText()
        assertTrue(plugin.contains("UpdateRules.askNotificationsFirst("))
        assertTrue(plugin.contains("requestPermissionForAlias(NOTIFICATIONS"))
        // A tap on Update in the page waits for Ember to come back.
        val updater = File("src/main/java/app/ember/music/AppUpdater.kt").readText()
        assertTrue(Regex("""fun installNow\(\) \{\s+GateHistory.installStarted\(app\)""").containsMatchIn(updater))
    }

    @Test fun `the install permission check still runs as an updater app`() {
        @Suppress("DEPRECATION")
        val asked = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty().toSet()
        assertTrue("android.permission.REQUEST_INSTALL_PACKAGES" in asked)
        assertTrue("android.permission.POST_NOTIFICATIONS" in asked)
    }
}
