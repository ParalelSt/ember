package app.ember.music

import android.content.ComponentName
import android.content.pm.PackageManager
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The updater's pieces around UpdateRules: what the app declares, how the
 *  player and the window report themselves, and the car's Home notice. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UpdaterWiringTest {
    private val app = RuntimeEnvironment.getApplication()

    @Before fun setUp() = UpdatePresence.reset()
    @After fun tearDown() = UpdatePresence.reset()

    @Test fun `the manifest asks for the install permissions and the boot-time reschedule`() {
        @Suppress("DEPRECATION")
        val info = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS)
        val asked = info.requestedPermissions.orEmpty().toSet()
        assertTrue("android.permission.REQUEST_INSTALL_PACKAGES" in asked)
        assertTrue("android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION" in asked)
        assertTrue("android.permission.RECEIVE_BOOT_COMPLETED" in asked)
    }

    @Test fun `the install receiver and the check job are private to the app`() {
        val pm = app.packageManager
        val receiver = pm.getReceiverInfo(ComponentName(app, UpdateInstallReceiver::class.java), 0)
        assertFalse(receiver.exported)
        val job = pm.getServiceInfo(ComponentName(app, UpdateCheckJob::class.java), 0)
        assertFalse(job.exported)
        assertEquals("android.permission.BIND_JOB_SERVICE", job.permission)
    }

    @Test fun `idle counts from when the music stopped or the app left the screen`() {
        // A fresh process (the 6-hourly job): nothing has played this run.
        assertEquals(Long.MAX_VALUE, UpdatePresence.idleMs(now = 10_000))
        UpdatePresence.setPlaying(true, now = 1_000)
        assertEquals(0L, UpdatePresence.idleMs(now = 5_000))
        UpdatePresence.setPlaying(false, now = 6_000)
        assertEquals(4_000L, UpdatePresence.idleMs(now = 10_000))
        UpdatePresence.setForeground(true, now = 11_000)
        assertEquals(0L, UpdatePresence.idleMs(now = 12_000))
        UpdatePresence.setForeground(false, now = 20_000)
        assertEquals(1_000L, UpdatePresence.idleMs(now = 21_000))
    }

    @Test fun `a change in music, car or window wakes the updater, a repeat does not`() {
        var calls = 0
        UpdatePresence.onChange = { calls++ }
        UpdatePresence.setPlaying(true)
        UpdatePresence.setPlaying(true)
        UpdatePresence.setCar(true)
        UpdatePresence.setCar(true)
        UpdatePresence.setForeground(true)
        UpdatePresence.setPlaying(false)
        assertEquals(4, calls)
        assertTrue(UpdatePresence.carConnected)
    }

    @Test fun `a listener that throws does not break the player that reported`() {
        UpdatePresence.onChange = { throw IllegalStateException("boom") }
        UpdatePresence.setPlaying(true)
        assertTrue(UpdatePresence.playing)
    }

    @Test fun `the car's Home shows the update notice on top, and nothing when there is none`() {
        val server = MockWebServer().apply { start() }
        try {
            val api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
            fun home() {
                server.enqueue(MockResponse().setBody("""{"tracks":[{"id":"a","title":"T","artist":"A","streamUrl":"/s/a"}]}"""))
                server.enqueue(MockResponse().setBody("""{"playlists":[]}"""))
            }
            var ready = false
            val tree = BrowseTree(api, notice = { UpdateRules.carNotice(ready) })
            home()
            assertEquals(listOf("home-recent|a"), tree.children(BrowseTree.HOME).map { it.mediaId })
            ready = true
            home()
            val items = tree.children(BrowseTree.HOME)
            assertEquals(2, items.size)
            val notice = items[0].mediaMetadata
            assertEquals("Ember update ready", notice.title.toString())
            assertTrue(notice.subtitle.toString().contains("parked"))
            assertEquals(false, notice.isPlayable)
            assertEquals(false, notice.isBrowsable)
            assertEquals("home-recent|a", items[1].mediaId)
        } finally {
            server.shutdown()
        }
    }

    @Test fun `a notice that fails to build leaves Home as it was`() {
        val server = MockWebServer().apply { start() }
        try {
            val api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
            server.enqueue(MockResponse().setBody("""{"tracks":[{"id":"a","title":"T","artist":"A","streamUrl":"/s/a"}]}"""))
            server.enqueue(MockResponse().setBody("""{"playlists":[]}"""))
            val tree = BrowseTree(api, notice = { throw IllegalStateException("updater not ready") })
            assertEquals(listOf("home-recent|a"), tree.children(BrowseTree.HOME).map { it.mediaId })
        } finally {
            server.shutdown()
        }
    }
}
