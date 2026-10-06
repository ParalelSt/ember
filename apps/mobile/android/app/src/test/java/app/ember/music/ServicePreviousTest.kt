package app.ember.music

import android.content.Intent
import android.os.Bundle
import android.os.Looper
import android.os.Process
import android.view.KeyEvent
import androidx.media3.common.Player
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.io.File
import java.time.Duration

/** Previous on the real player service follows the play history
 *  (PlayHistory), whichever way it arrives: the app's button
 *  (COMMAND_PREVIOUS), the session player's seekToPrevious (the notification,
 *  the lock screen, the car) and a Bluetooth previous key. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServicePreviousTest {
    private val app = RuntimeEnvironment.getApplication()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)
    private val headUnit = MediaSession.ControllerInfo.createTestOnlyControllerInfo(
        "com.android.bluetooth", 0, 1002, MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION, 0, false, Bundle.EMPTY)
    private val savedFile get() = File(app.filesDir, SavedQueue.FILE_NAME)

    @Before fun setUp() {
        savedFile.delete()
        EmberMediaButtonReceiver.appContext = app
        controller = Robolectric.buildService(EmberPlaybackService::class.java)
        controller.create()
        service = controller.get()
    }

    @After fun tearDown() {
        runCatching { controller.destroy() }
        MediaCache.releaseShared()
        savedFile.delete()
    }

    private fun session() = service.onGetSession(own)
    private fun player(): Player = session().player
    private fun idle(ms: Long = 0) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun track(id: String) = JSONObject("""{"id":"$id","title":"T $id","artist":"A","durationSec":120,"streamUrl":"/api/youtube/stream/$id"}""")

    /** An auto-generated (radio) queue, a playing, then d tapped. */
    private fun playThenTap() {
        player().setMediaItems(listOf("a", "b", "c", "d").map { TrackItems.toMediaItem(track(it), "http://127.0.0.1:9") }, 0, 0)
        idle()
        player().seekTo(3, 0) // the app's tap in the queue (QueueSync's Seek)
        idle()
    }

    private fun command(action: String): SessionResult =
        service.Callback().onCustomCommand(session(), own, SessionCommand(action, Bundle.EMPTY), Bundle.EMPTY).get()

    @Test fun `the app's Previous goes back to the song played before the tap`() {
        playThenTap()
        assertEquals(SessionResult.RESULT_SUCCESS, command(EmberPlaybackService.COMMAND_PREVIOUS).resultCode)
        idle()
        assertEquals(0, player().currentMediaItemIndex)
    }

    @Test fun `only Ember itself gets the app's Previous command`() {
        val cmds = service.Callback().onConnect(session(), own).availableSessionCommands
        assertTrue(cmds.contains(SessionCommand(EmberPlaybackService.COMMAND_PREVIOUS, Bundle.EMPTY)))
    }

    @Test fun `the notification, lock screen and car go back the same way`() {
        playThenTap()
        player().seekToPrevious()
        idle()
        assertEquals(0, player().currentMediaItemIndex)
    }

    @Test fun `a Bluetooth previous key goes back the same way`() {
        playThenTap()
        service.Callback().onMediaButtonEvent(session(), headUnit,
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS)))
        idle()
        assertEquals(0, player().currentMediaItemIndex)
    }

    @Test fun `past 3 s Previous still starts the song over first`() {
        playThenTap()
        player().seekTo(60_000)
        idle()
        command(EmberPlaybackService.COMMAND_PREVIOUS)
        idle()
        assertEquals(3, player().currentMediaItemIndex)
        assertEquals(0L, player().currentPosition)
        command(EmberPlaybackService.COMMAND_PREVIOUS)
        idle()
        assertEquals(0, player().currentMediaItemIndex)
    }

    // ── The app's "Played" list ─────────────────────────────────────────

    private fun played() = session().sessionExtras.getStringArrayList(EmberPlaybackService.EXTRA_PLAYED)

    @Test fun `the service publishes the play history for the app's queue sheet`() {
        playThenTap()
        assertEquals(listOf("a"), played())
        player().seekTo(1, 0) // b tapped
        idle()
        assertEquals(listOf("a", "d"), played())
        assertEquals(listOf("a", "d"), playedOf(session().sessionExtras))
    }

    @Test fun `a tap on a played song goes back to it through the history`() {
        playThenTap()
        player().seekTo(1, 60_000) // b tapped, a minute in
        idle()
        val args = Bundle().apply { putInt("index", 0) }
        val result = service.Callback().onCustomCommand(session(), own, SessionCommand(EmberPlaybackService.COMMAND_BACK, Bundle.EMPTY), args).get()
        assertEquals(SessionResult.RESULT_SUCCESS, result.resultCode)
        idle()
        assertEquals(0, player().currentMediaItemIndex)
        assertEquals(4, player().mediaItemCount)
        assertEquals(emptyList<String>(), played())
    }

    @Test fun `only Ember itself gets the back command`() {
        val cmds = service.Callback().onConnect(session(), own).availableSessionCommands
        assertTrue(cmds.contains(SessionCommand(EmberPlaybackService.COMMAND_BACK, Bundle.EMPTY)))
        val car = service.Callback().onConnect(session(), headUnit).availableSessionCommands
        assertTrue(!car.contains(SessionCommand(EmberPlaybackService.COMMAND_BACK, Bundle.EMPTY)))
    }

    @Test fun `an older service without the history reads as none to show`() {
        assertEquals(null, playedOf(Bundle.EMPTY))
    }
}
