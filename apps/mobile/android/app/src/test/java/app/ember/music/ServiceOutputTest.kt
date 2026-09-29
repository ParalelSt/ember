package app.ember.music

import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import android.os.Looper
import android.os.Process
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import org.junit.After
import org.json.JSONObject
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
import org.robolectric.shadows.AudioDeviceInfoBuilder

/** The service as built on the phone: the picker's COMMAND_OUTPUT pins an
 *  output, the pin reaches the app through the session extras (next to the
 *  cache state, not instead of it), and unplugging the pinned output lets
 *  it go. Only our own app may send it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServiceOutputTest {
    private val app = RuntimeEnvironment.getApplication()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)
    private val audio = app.getSystemService(AudioManager::class.java)
    private val headset: AudioDeviceInfo = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP).build()

    private fun startService() {
        shadowOf(audio).setOutputDevices(listOf(headset))
        controller = Robolectric.buildService(EmberPlaybackService::class.java).create()
        service = controller.get()
    }

    @After fun tearDown() {
        if (::controller.isInitialized) controller.destroy()
        MediaCache.releaseShared()
    }

    private fun session() = service.onGetSession(own)
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun output(id: Int): SessionResult {
        val f = service.Callback().onCustomCommand(session(), own, SessionCommand(EmberPlaybackService.COMMAND_OUTPUT, Bundle.EMPTY), Bundle().apply { putInt("deviceId", id) })
        idle()
        return f.get()
    }

    private fun published() = session().sessionExtras.getInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED, -99)

    @Test fun `our own app may pin an output, the car may not`() {
        startService()
        val ours = service.Callback().onConnect(session(), own)
        assertTrue(ours.availableSessionCommands.contains(SessionCommand(EmberPlaybackService.COMMAND_OUTPUT, Bundle.EMPTY)))
        // A preinstalled Android Auto connects, without the output command.
        val gearhead = "com.google.android.projection.gearhead"
        shadowOf(app.packageManager).installPackage(PackageInfo().apply {
            packageName = gearhead
            applicationInfo = ApplicationInfo().apply { packageName = gearhead; uid = 10_780; flags = ApplicationInfo.FLAG_SYSTEM }
        })
        val car = MediaSession.ControllerInfo.createTestOnlyControllerInfo(gearhead, 0, 10_780, 0, 0, false, Bundle.EMPTY)
        val theirs = service.Callback().onConnect(session(), car)
        assertTrue(theirs.isAccepted)
        assertFalse(theirs.availableSessionCommands.contains(SessionCommand(EmberPlaybackService.COMMAND_OUTPUT, Bundle.EMPTY)))
    }

    @Test fun `pinning a connected output is published, and so is automatic`() {
        startService()
        val r = output(headset.id)
        assertEquals(SessionResult.RESULT_SUCCESS, r.resultCode)
        assertEquals(headset.id, r.extras.getInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED))
        assertEquals(headset.id, published())

        val auto = output(-1)
        assertEquals(SessionResult.RESULT_SUCCESS, auto.resultCode)
        assertEquals(-1, auto.extras.getInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED))
        assertEquals(-1, published())
    }

    @Test fun `an output that is not connected is refused`() {
        startService()
        val r = output(headset.id + 1000)
        assertEquals(SessionResult.RESULT_ERROR_BAD_VALUE, r.resultCode)
        assertEquals(-1, r.extras.getInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED))
    }

    @Test fun `the pin rides with the cache state, which stays`() {
        startService()
        val item = TrackItems.toMediaItem(JSONObject("""{"id":"youtube:a","title":"a","artist":"X","streamUrl":"/s/a"}"""), "https://ember.example")
        session().player.setMediaItems(listOf(item))
        idle()
        assertTrue(session().sessionExtras.containsKey(EmberPlaybackService.EXTRA_OFFLINE))
        output(headset.id)
        val extras = session().sessionExtras
        assertEquals(headset.id, extras.getInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED))
        // The cache state published at start is still there.
        assertTrue(extras.containsKey(EmberPlaybackService.EXTRA_OFFLINE))
        assertTrue(extras.containsKey(EmberPlaybackService.EXTRA_CACHED_IDS))
    }

    @Test fun `unplugging the pinned output goes back to automatic`() {
        startService()
        output(headset.id)
        shadowOf(audio).removeOutputDevice(headset, true)
        idle()
        assertEquals(-1, published())
    }
}
