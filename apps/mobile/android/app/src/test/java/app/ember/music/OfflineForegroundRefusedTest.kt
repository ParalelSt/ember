package app.ember.music

import android.app.Notification
import android.app.Service
import android.content.Intent
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowService

/** Android refuses a foreground start it does not allow (Android 12+ from the
 *  background, Android 15 once the dataSync daily quota is used up) by
 *  throwing out of startForeground. Unguarded in onStartCommand, on the main
 *  thread, that took the whole app down, music included: a sticky restart in
 *  the background got there. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [OfflineForegroundRefusedTest.RefusingShadow::class])
class OfflineForegroundRefusedTest {
    /** startForeground as Android does it when the start is not allowed.
     *  ForegroundServiceStartNotAllowedException is an IllegalStateException. */
    @Implements(Service::class)
    class RefusingShadow : ShadowService() {
        @Implementation
        override fun startForeground(id: Int, notification: Notification) {
            throw IllegalStateException("startForegroundService() not allowed due to mAllowStartForeground false")
        }
    }

    private val logged = mutableListOf<JSONObject>()

    @Before fun setUp() {
        NativeLog.reset()
        NativeLog.attach { logged.add(it); true }
    }

    @After fun tearDown() { NativeLog.reset() }

    @Test fun aRefusedForegroundStartStopsTheServiceInsteadOfCrashing() {
        val controller = Robolectric.buildService(OfflineDownloadService::class.java).create()
        val service = controller.get()

        val result = service.onStartCommand(Intent(), 0, 7)

        assertTrue("stopped itself", shadowOf(service).isStoppedBySelf)
        assertEquals("not restarted into the same refusal", Service.START_NOT_STICKY, result)
        assertTrue("the web side hears why", logged.any { it.getString("level") == "error" && it.getString("message").contains("not allowed") })
    }
}
