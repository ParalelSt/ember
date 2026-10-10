package app.ember.music

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/** How the launch gate sits in the app: the home screen icon opens it under
 *  its old component name, it hands every launch it does not gate straight
 *  to the app, and the app reports a launch that worked. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LaunchGateWiringTest {
    private val app = RuntimeEnvironment.getApplication()

    @Before fun setUp() = UpdatePresence.reset()
    @After fun tearDown() = UpdatePresence.reset()

    @Test fun `the icon still opens app_ember_music_MainActivity, which is now the gate`() {
        val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)
        assertNotNull("no launcher entry", launch)
        assertEquals("${app.packageName}.MainActivity", launch!!.component!!.className)
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(Regex("""<activity-alias\s+android:name="\.MainActivity"\s+android:targetActivity="\.LaunchGateActivity"""").containsMatchIn(manifest))
    }

    @Test fun `the app and the gate themselves are private, the relaunch receiver too`() {
        val pm = app.packageManager
        assertFalse(pm.getActivityInfo(ComponentName(app, EmberActivity::class.java), 0).exported)
        assertFalse(pm.getActivityInfo(ComponentName(app, LaunchGateActivity::class.java), 0).exported)
        assertFalse(pm.getReceiverInfo(ComponentName(app, UpdatedReceiver::class.java), 0).exported)
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.intent.action.MY_PACKAGE_REPLACED"))
    }

    @Test fun `a start that is not a launcher tap goes straight into the app`() {
        val intent = Intent(app, LaunchGateActivity::class.java).setAction(Intent.ACTION_VIEW)
        val gate = Robolectric.buildActivity(LaunchGateActivity::class.java, intent).create().get()
        val next = shadowOf(gate).nextStartedActivity
        assertEquals(EmberActivity::class.java.name, next.component!!.className)
        assertEquals(Intent.ACTION_VIEW, next.action)
        assertTrue(gate.isFinishing)
    }

    @Test fun `a launcher tap with music already playing goes straight into the app`() {
        UpdatePresence.setPlaying(true)
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClass(app, LaunchGateActivity::class.java)
        val gate = Robolectric.buildActivity(LaunchGateActivity::class.java, intent).create().get()
        assertEquals(EmberActivity::class.java.name, shadowOf(gate).nextStartedActivity.component!!.className)
    }

    @Test fun `the launch history survives in preferences`() {
        val first = GateHistory.start(app)
        assertEquals(GateRules.Stage.STARTING, first.history.stage)
        assertEquals(GateRules.Stage.STARTING, GateHistory.load(app).stage)
        GateHistory.mark(app, GateRules.Stage.GATED)
        assertEquals(GateRules.Stage.GATED, GateHistory.load(app).stage)
        GateHistory.mark(app, GateRules.Stage.READY)
        assertEquals(GateRules.History(GateRules.Stage.READY, 0, 0, first.history.lastVersion), GateHistory.load(app))
    }

    @Test fun `the app reports its first page load to the launch history`() {
        val activity = File("src/main/java/app/ember/music/EmberActivity.java").readText()
        assertTrue(activity.contains("GateHistory.INSTANCE.mark(EmberActivity.this, GateRules.Stage.READY)"))
    }

    @Test fun `the install permission check still runs as an updater app`() {
        @Suppress("DEPRECATION")
        val asked = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty().toSet()
        assertTrue("android.permission.REQUEST_INSTALL_PACKAGES" in asked)
        assertTrue("android.permission.POST_NOTIFICATIONS" in asked)
    }
}
