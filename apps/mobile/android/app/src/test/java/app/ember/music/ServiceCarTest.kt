package app.ember.music

import android.content.Intent
import android.os.Bundle
import android.os.Looper
import android.os.Process
import android.view.KeyEvent
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

/** The player service as the car, a head unit and a mirroring app see it:
 *  shuffle and repeat from the car's buttons, the buttons' state, media keys
 *  (including with the app closed), and the browse root. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ServiceCarTest {
    private val app = RuntimeEnvironment.getApplication()
    private lateinit var controller: ServiceController<EmberPlaybackService>
    private lateinit var service: EmberPlaybackService
    private val own = MediaSession.ControllerInfo.createTestOnlyControllerInfo(app.packageName, 0, Process.myUid(), 0, 0, false, Bundle.EMPTY)
    /** A Bluetooth head unit or a mirroring app: a legacy (platform) controller. */
    private val headUnit = MediaSession.ControllerInfo.createTestOnlyControllerInfo(
        "com.android.bluetooth", 0, 1002, MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION, 0, false, Bundle.EMPTY)
    private val car = MediaSession.ControllerInfo.createTestOnlyControllerInfo(
        "com.google.android.projection.gearhead", 0, 10_300, MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION, 0, false, Bundle.EMPTY)
    private val savedFile get() = File(app.filesDir, SavedQueue.FILE_NAME)

    @Before fun setUp() {
        savedFile.delete()
        EmberMediaButtonReceiver.appContext = app
    }

    @After fun tearDown() {
        if (::controller.isInitialized) runCatching { controller.destroy() }
        MediaCache.releaseShared()
        savedFile.delete()
    }

    private fun start(intent: Intent? = null) {
        controller = if (intent == null) Robolectric.buildService(EmberPlaybackService::class.java) else Robolectric.buildService(EmberPlaybackService::class.java, intent)
        controller.create()
        service = controller.get()
    }

    private fun session() = service.onGetSession(own)
    private fun player() = session().player
    private fun idle(ms: Long = 0) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    /** Runs the main looper until [done], for work that hops to a thread. */
    private fun until(done: () -> Boolean) {
        val end = System.currentTimeMillis() + 3_000
        while (!done() && System.currentTimeMillis() < end) { idle(10); Thread.sleep(5) }
    }

    private fun track(id: String) = JSONObject("""{"id":"$id","title":"T $id","artist":"A","durationSec":120,"streamUrl":"/api/youtube/stream/$id"}""")
    private fun items(vararg ids: String) = ids.map { TrackItems.toMediaItem(track(it), "http://127.0.0.1:9") }
    private fun ids(p: Player = player()) = (0 until p.mediaItemCount).map { p.getMediaItemAt(it).mediaId }

    private fun load(vararg id: String, index: Int = 0) {
        player().setMediaItems(items(*id), index, 0)
        idle()
    }

    private fun command(action: String, args: Bundle = Bundle.EMPTY, who: MediaSession.ControllerInfo = own): SessionResult =
        service.Callback().onCustomCommand(session(), who, SessionCommand(action, Bundle.EMPTY), args).get()

    private fun key(code: Int, who: MediaSession.ControllerInfo = headUnit): Boolean =
        service.Callback().onMediaButtonEvent(session(), who,
            Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, code)))

    private fun buttonNames() = session().customLayout.map { it.displayName.toString() }

    // ── Shuffle and repeat from the car ─────────────────────────────────

    @Test fun `the car's shuffle reorders the songs to come and off puts them back`() {
        start()
        val order = listOf("a", "b", "c", "d", "e", "f", "g", "h")
        load(*order.toTypedArray(), index = 1)
        assertEquals(listOf("Shuffle off", "Repeat off"), buttonNames())

        player().shuffleModeEnabled = true // what Media3 calls for a controller's shuffle
        idle()
        val shuffled = ids()
        assertEquals(listOf("a", "b"), shuffled.take(2))
        assertEquals(order.drop(2).toSet(), shuffled.drop(2).toSet())
        assertEquals("b", player().currentMediaItem!!.mediaId)
        assertTrue(player().shuffleModeEnabled)
        assertTrue(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_SHUFFLE))
        assertEquals(listOf("Shuffle on", "Repeat off"), buttonNames())
        // The flag does not reorder play a second time: next is the next in the list.
        assertEquals(2, player().nextMediaItemIndex)

        // Off from the notification's (or car's) button this time.
        assertEquals(SessionResult.RESULT_SUCCESS, command(EmberPlaybackService.COMMAND_SHUFFLE, who = car).resultCode)
        idle()
        assertEquals(order, ids())
        assertEquals("b", player().currentMediaItem!!.mediaId)
        assertFalse(player().shuffleModeEnabled)
        assertFalse(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_SHUFFLE))
        assertEquals(listOf("Shuffle off", "Repeat off"), buttonNames())
    }

    @Test fun `the app's own shuffle only sets the flag, and the car can undo it`() {
        start()
        // The app has shuffled its queue itself and sends it with the order before.
        load("a", "d", "c", "b", index = 0)
        val args = Bundle().apply { putBoolean("on", true); putStringArrayList("order", arrayListOf("a", "b", "c", "d")) }
        command(EmberPlaybackService.COMMAND_SHUFFLE_STATE, args)
        idle()
        assertEquals(listOf("a", "d", "c", "b"), ids())
        assertTrue(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_SHUFFLE))
        assertEquals("Shuffle on", buttonNames()[0])
        // The car's button now turns it off and restores the app's order.
        command(EmberPlaybackService.COMMAND_SHUFFLE, who = car)
        idle()
        assertEquals(listOf("a", "b", "c", "d"), ids())
    }

    @Test fun `the app turning shuffle off keeps its own queue, unless it asks for the order back`() {
        start()
        val order = listOf("a", "b", "c", "d", "e", "f")
        load(*order.toTypedArray(), index = 0)
        player().shuffleModeEnabled = true // the car
        idle()
        val shuffled = ids()
        // The app moved on to a queue of its own: off must not reorder it.
        command(EmberPlaybackService.COMMAND_SHUFFLE_STATE, Bundle().apply { putBoolean("on", false) })
        idle()
        assertEquals(shuffled, ids())
        assertFalse(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_SHUFFLE))

        // A page that never had the order asks for it back.
        player().shuffleModeEnabled = true
        idle()
        command(EmberPlaybackService.COMMAND_SHUFFLE_STATE, Bundle().apply { putBoolean("on", false); putBoolean("restore", true) })
        idle()
        assertEquals(shuffled, ids())
    }

    @Test fun `a notification tap on a running service does not arm the foreground guard`() {
        start()
        load("a")
        controller.startCommand(0, 1) // the service's first start (not a media button)
        val tap = Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
        service.onStartCommand(tap, 0, 2)
        idle(EmberPlaybackService.MEDIA_BUTTON_GUARD_MS + 500)
        assertFalse(shadowOf(service).isForegroundStopped)
        assertFalse(shadowOf(service).isStoppedBySelf)
    }

    @Test fun `a new list from the car is not shuffled`() {
        start()
        load("a", "b", "c", index = 0)
        player().shuffleModeEnabled = true
        idle()
        service.Callback().onSetMediaItems(session(), car, mutableListOf(MediaItem.Builder().setMediaId("x").build()), 0, 0)
        idle()
        assertFalse(player().shuffleModeEnabled)
        assertFalse(session().sessionExtras.getBoolean(EmberPlaybackService.EXTRA_SHUFFLE))
    }

    @Test fun `repeat cycles from the car and the button follows`() {
        start()
        load("a", "b")
        command(EmberPlaybackService.COMMAND_REPEAT, who = car); idle()
        assertEquals(Player.REPEAT_MODE_ALL, player().repeatMode)
        assertEquals("Repeat all", buttonNames().last())
        command(EmberPlaybackService.COMMAND_REPEAT, who = car); idle()
        assertEquals("Repeat one", buttonNames().last())
        command(EmberPlaybackService.COMMAND_REPEAT, who = car); idle()
        assertEquals(Player.REPEAT_MODE_OFF, player().repeatMode)
        // The app's loop button lands on the same button.
        player().repeatMode = Player.REPEAT_MODE_ONE; idle()
        assertEquals("Repeat one", buttonNames().last())
    }

    @Test fun `the heart waits until the liked songs are known`() {
        start()
        load("a")
        assertFalse(buttonNames().any { it.contains("Liked") })
        assertEquals(SessionResult.RESULT_ERROR_INVALID_STATE, command(CarButtons.COMMAND_LIKE, who = car).resultCode)
    }

    @Test fun `the car may use the buttons, strangers' commands stay the app's own`() {
        start()
        val connect = service.Callback().onConnect(session(), car)
        // Robolectric has no Android Auto installed: the gate refuses it. The
        // commands a car gets are checked on Ember's own connection instead.
        val mine = service.Callback().onConnect(session(), own)
        val cmds = mine.availableSessionCommands
        assertTrue(cmds.contains(SessionCommand(CarButtons.COMMAND_LIKE, Bundle.EMPTY)))
        assertTrue(cmds.contains(SessionCommand(EmberPlaybackService.COMMAND_SHUFFLE_STATE, Bundle.EMPTY)))
        assertFalse(connect.isAccepted)
    }

    // ── Media keys ──────────────────────────────────────────────────────

    @Test fun `one press plays or pauses, two skip, three go back`() {
        start()
        load("a", "b", "c", index = 0)
        assertTrue(key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        idle(100)
        assertFalse("waits to see if more presses come", player().playWhenReady)
        idle(400)
        assertTrue(player().playWhenReady)

        player().pause(); idle()
        key(KeyEvent.KEYCODE_HEADSETHOOK); idle(100); key(KeyEvent.KEYCODE_HEADSETHOOK); idle(450)
        assertEquals(1, player().currentMediaItemIndex)
        assertFalse("a double press is not also a play-pause", player().playWhenReady)

        player().seekTo(2, 0); idle()
        key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); idle(100); key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); idle(100); key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); idle(450)
        assertEquals(1, player().currentMediaItemIndex)
    }

    @Test fun `a car's own next, previous, play, pause and stop keys act at once`() {
        start()
        load("a", "b", "c", index = 0)
        key(KeyEvent.KEYCODE_MEDIA_PLAY); idle()
        assertTrue(player().playWhenReady)
        key(KeyEvent.KEYCODE_MEDIA_NEXT); idle()
        assertEquals(1, player().currentMediaItemIndex)
        key(KeyEvent.KEYCODE_MEDIA_PREVIOUS); idle()
        assertEquals(0, player().currentMediaItemIndex)
        key(KeyEvent.KEYCODE_MEDIA_STOP); idle()
        assertFalse(player().playWhenReady)
        assertEquals("stop keeps the queue", 3, player().mediaItemCount)
        assertFalse("not a media key", key(KeyEvent.KEYCODE_VOLUME_UP))
    }

    @Test fun `play with nothing loaded resumes the saved queue where it was`() {
        SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(track("a"), track("b"), track("c")), 1, 42_000))
        start()
        assertEquals(0, player().mediaItemCount)
        key(KeyEvent.KEYCODE_MEDIA_PLAY)
        until { player().mediaItemCount > 0 }
        assertEquals(listOf("a", "b", "c"), ids())
        assertEquals(1, player().currentMediaItemIndex)
        assertEquals(42_000L, player().currentPosition)
        assertTrue(player().playWhenReady)
    }

    @Test fun `play-pause with nothing loaded resumes too, next does nothing`() {
        SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(track("a")), 0, 0))
        start()
        key(KeyEvent.KEYCODE_MEDIA_NEXT); idle(500)
        assertEquals(0, player().mediaItemCount)
        key(KeyEvent.KEYCODE_HEADSETHOOK); idle(450)
        until { player().mediaItemCount > 0 }
        assertTrue(player().playWhenReady)
    }

    @Test fun `a press still being counted when the service goes away does nothing (no crash)`() {
        // Nothing to resume: the foreground guard lets the service go while
        // the headset's single press is still waiting for a second one.
        start()
        assertTrue(key(KeyEvent.KEYCODE_HEADSETHOOK))
        idle(100)
        controller.destroy()
        // Before: the press settled after the service was gone, asked the
        // shut-down resume executor to load the saved queue, and threw
        // RejectedExecutionException on the main thread (the app crashed).
        idle(450)
    }

    // ── With the app closed (EmberMediaButtonReceiver + the service) ────

    private fun mediaButton(code: Int) = Intent(Intent.ACTION_MEDIA_BUTTON).putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, code))

    @Test fun `the receiver starts the player for play when there is a queue to resume`() {
        SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(track("a")), 0, 0))
        EmberMediaButtonReceiver().onReceive(app, mediaButton(KeyEvent.KEYCODE_MEDIA_PLAY))
        val started = shadowOf(app).nextStartedService
        assertEquals(EmberPlaybackService::class.java.name, started?.component?.className)
    }

    @Test fun `the receiver starts nothing without a saved queue, or for other keys`() {
        EmberMediaButtonReceiver().onReceive(app, mediaButton(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertNull(shadowOf(app).nextStartedService)
        SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(track("a")), 0, 0))
        EmberMediaButtonReceiver().onReceive(app, mediaButton(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertNull(shadowOf(app).nextStartedService)
    }

    @Test fun `a cold start for play resumes the queue and keeps the service`() {
        SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(track("a"), track("b")), 1, 0))
        start(mediaButton(KeyEvent.KEYCODE_MEDIA_PLAY))
        controller.startCommand(0, 1)
        until { player().mediaItemCount > 0 }
        assertEquals(listOf("a", "b"), ids())
        assertTrue(player().playWhenReady)
        idle(EmberPlaybackService.MEDIA_BUTTON_GUARD_MS + 100)
        assertFalse(shadowOf(service).isStoppedBySelf)
    }

    @Test fun `a cold start with nothing to play lets go instead of being killed`() {
        // The receiver would not have started it; the queue failed to load.
        savedFile.writeText("{ broken")
        start(mediaButton(KeyEvent.KEYCODE_MEDIA_PLAY))
        controller.startCommand(0, 1)
        idle(1_000)
        assertFalse(shadowOf(service).isStoppedBySelf)
        idle(EmberPlaybackService.MEDIA_BUTTON_GUARD_MS)
        assertTrue("was in the foreground for a moment", shadowOf(service).isForegroundStopped)
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    // ── Voice and browsing ──────────────────────────────────────────────

    @Test fun `play music on Ember with no words resumes the saved queue`() {
        SavedQueue(savedFile).save(SavedQueue.Snapshot(listOf(track("a"), track("b")), 1, 0))
        start()
        val ask = MediaItem.Builder().setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery("").build()).build()
        val f = service.Callback().onSetMediaItems(session(), car, mutableListOf(ask), 0, 0)
        until { f.isDone }
        assertEquals(listOf("a", "b"), f.get().mediaItems.map { it.mediaId })
        assertEquals(1, f.get().startIndex)
    }

    @Test fun `the root hands the car list styles, and pages are honoured`() {
        start()
        val root = service.Callback().onGetLibraryRoot(session(), own, null).get()
        assertEquals(LibraryResult.RESULT_SUCCESS, root.resultCode)
        assertEquals(MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM, root.params!!.extras.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE))
        val f = service.Callback().onGetChildren(session(), own, BrowseTree.ROOT, 1, 2, null)
        until { f.isDone }
        assertEquals(listOf(BrowseTree.PLAYLISTS, BrowseTree.LIBRARY), f.get().value!!.map { it.mediaId })
    }

    @Test fun `a song the car was shown can be looked up by id`() {
        start()
        val none = service.Callback().onGetItem(session(), own, "liked|nope").get()
        assertEquals(LibraryResult.RESULT_ERROR_BAD_VALUE, none.resultCode)
    }

    @Test fun `the queue's metadata carries the song's length for head units`() {
        start()
        load("a")
        assertEquals(120_000L, player().currentMediaItem!!.mediaMetadata.durationMs)
        assertEquals(MediaMetadata.MEDIA_TYPE_MUSIC, player().currentMediaItem!!.mediaMetadata.mediaType)
    }
}
