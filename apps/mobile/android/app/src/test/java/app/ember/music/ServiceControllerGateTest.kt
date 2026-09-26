package app.ember.music

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.os.Bundle
import android.os.Process
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaSession
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config

/** The exported playback service against real controllers (security audit
 *  2026-09-25, M4). On main it accepted every one, so any installed app could
 *  bind and browse the member's library, history and search. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServiceControllerGateTest {
    private val app = RuntimeEnvironment.getApplication()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService

    private fun start() {
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        service = controller.get()
    }

    @After fun tearDown() {
        if (::controller.isInitialized) runCatching { controller.destroy() }
    }

    private fun info(pkg: String, uid: Int, trusted: Boolean = false) =
        MediaSession.ControllerInfo.createTestOnlyControllerInfo(pkg, 0, uid, 0, 0, trusted, Bundle.EMPTY)

    private fun install(pkg: String, uid: Int, system: Boolean = false) {
        val pi = PackageInfo().apply {
            packageName = pkg
            applicationInfo = ApplicationInfo().apply {
                packageName = pkg
                this.uid = uid
                flags = if (system) ApplicationInfo.FLAG_SYSTEM else 0
            }
        }
        shadowOf(app.packageManager).installPackage(pi)
    }

    private fun session() = service.onGetSession(info(app.packageName, Process.myUid()))

    @Test fun `Ember's own controllers still connect and see the library root`() {
        start()
        val own = info(app.packageName, Process.myUid())
        assertTrue(service.Callback().onConnect(session(), own).isAccepted)
        val root = service.Callback().onGetLibraryRoot(session(), own, null).get()
        assertEquals(LibraryResult.RESULT_SUCCESS, root.resultCode)
    }

    @Test fun `an installed stranger is refused, and gets no library root`() {
        install("com.example.spyware", 10_777)
        start()
        val stranger = info("com.example.spyware", 10_777)
        assertFalse(service.Callback().onConnect(session(), stranger).isAccepted)
        val root = service.Callback().onGetLibraryRoot(session(), stranger, null).get()
        assertEquals(LibraryResult.RESULT_ERROR_PERMISSION_DENIED, root.resultCode)
    }

    @Test fun `a stranger using Android Auto's package name without being it is refused`() {
        install("com.google.android.projection.gearhead", 10_778, system = false)
        start()
        assertFalse(service.Callback().onConnect(session(), info("com.google.android.projection.gearhead", 10_778)).isAccepted)
        // Claiming a name the package manager has under another uid.
        assertFalse(service.Callback().onConnect(session(), info("com.google.android.projection.gearhead", 10_779)).isAccepted)
    }

    @Test fun `a preinstalled Android Auto connects`() {
        install("com.google.android.projection.gearhead", 10_780, system = true)
        start()
        assertTrue(service.Callback().onConnect(session(), info("com.google.android.projection.gearhead", 10_780)).isAccepted)
    }

    @Test fun `a controller Android trusts for media control connects`() {
        install("com.example.watchcompanion", 10_781)
        start()
        assertTrue(service.Callback().onConnect(session(), info("com.example.watchcompanion", 10_781, trusted = true)).isAccepted)
    }
}
