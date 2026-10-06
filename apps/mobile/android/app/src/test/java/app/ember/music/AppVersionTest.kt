package app.ember.music

import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import java.io.File

/**
 * The phone app's own version, for the settings footer ("App 0.4.14"): the
 * web build and the app are released separately, so the page asks the app
 * (EmberAppPlugin) rather than guessing.
 */
@RunWith(RobolectricTestRunner::class)
class AppVersionTest {
    private val app = RuntimeEnvironment.getApplication()

    private fun versionName(v: String?) {
        shadowOf(app.packageManager).getInternalMutablePackageInfo(app.packageName).versionName = v
    }

    @Test
    fun `reads the versionName the app was built with`() {
        versionName("0.4.14")
        assertEquals("0.4.14", AppVersion.name(app))
    }

    @Test
    fun `a blank or missing versionName is no version`() {
        versionName("  ")
        assertNull(AppVersion.name(app))
        versionName(null)
        assertNull(AppVersion.name(app))
    }

    @Test
    fun `the page finds it under the plugin name it asks for, registered at start`() {
        assertEquals("EmberApp", EmberAppPlugin::class.java.getAnnotation(CapacitorPlugin::class.java)?.name)
        val activity = File("src/main/java/app/ember/music/MainActivity.java").readText()
        assertTrue(activity.contains("registerPlugin(EmberAppPlugin.class)"))
    }
}
