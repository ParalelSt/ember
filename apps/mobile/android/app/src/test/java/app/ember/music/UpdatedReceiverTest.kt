package app.ember.music

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import org.junit.After
import org.junit.Assert.assertEquals
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

/** Ember after it updated itself: Android does not reopen it, so the new
 *  version brings itself back where Android lets it (before Android 10) and
 *  posts "Ember updated, tap to open" where it does not. */
@RunWith(RobolectricTestRunner::class)
class UpdatedReceiverTest {
    private val app = RuntimeEnvironment.getApplication()
    private val nm get() = shadowOf(app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)

    @Before fun setUp() = UpdatePresence.reset()
    @After fun tearDown() = UpdatePresence.reset()

    private fun replaced() = UpdatedReceiver().onReceive(app, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

    @Config(sdk = [28])
    @Test fun `before Android 10 the updated app opens itself again, without a notification`() {
        GateHistory.installStarted(app)
        replaced()
        val started = shadowOf(app).nextStartedActivity
        assertNotNull("Ember did not reopen", started)
        assertEquals("${app.packageName}.MainActivity", started.component!!.className)
        assertTrue(started.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(0, nm.allNotifications.size)
    }

    @Config(sdk = [34])
    @Test fun `from Android 10 it posts the tap-to-open notice instead`() {
        GateHistory.installStarted(app)
        replaced()
        assertNull(shadowOf(app).nextStartedActivity)
        assertEquals(1, nm.allNotifications.size)
    }

    @Config(sdk = [28])
    @Test fun `an update nobody was waiting for does not open Ember`() {
        replaced()
        assertNull(shadowOf(app).nextStartedActivity)
        assertEquals(0, nm.allNotifications.size)
    }
}
