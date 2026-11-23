package app.ember.music

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
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

    @Test fun `the manifest asks for the install permissions and the boot start`() {
        @Suppress("DEPRECATION")
        val info = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS)
        val asked = info.requestedPermissions.orEmpty().toSet()
        assertTrue("android.permission.REQUEST_INSTALL_PACKAGES" in asked)
        assertTrue("android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION" in asked)
        assertTrue("android.permission.RECEIVE_BOOT_COMPLETED" in asked)
    }

    @Test fun `the install receiver is private to the app`() {
        val pm = app.packageManager
        val receiver = pm.getReceiverInfo(ComponentName(app, UpdateInstallReceiver::class.java), 0)
        assertFalse(receiver.exported)
    }

    @Test fun `the update check job is not declared any more, updates wait for a tap`() {
        @Suppress("DEPRECATION")
        val services = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_SERVICES).services.orEmpty()
        assertTrue(services.none { it.name.endsWith(".UpdateCheckJob") })
        // The rest of the app's own services are still there.
        assertTrue(services.any { it.name.endsWith(".EmberPlaybackService") })
    }

    @Test fun `the 6-hourly job an older version scheduled is dropped on start`() {
        val js = app.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        // What 0.4.35 and older left behind (persisted across the update).
        js.schedule(JobInfo.Builder(LegacyUpdateJob.JOB_ID, ComponentName(app, "app.ember.music.UpdateCheckJob"))
            .setPeriodic(6 * 60 * 60 * 1000L).build())
        js.schedule(JobInfo.Builder(1, ComponentName(app, "app.ember.music.Other")).setMinimumLatency(1).build())
        assertTrue(js.allPendingJobs.any { it.id == LegacyUpdateJob.JOB_ID })
        AppUpdater.resetForTest(PlaybackLog(send = {}, online = { false }, io = { it.run() }, delay = { _, _ -> {} },
            surface = { Surfaces.PHONE }, device = org.json.JSONObject()), work = { it.run() }, baseUrl = "http://127.0.0.1:9")
        AppUpdater.init(app)
        assertFalse(js.allPendingJobs.any { it.id == LegacyUpdateJob.JOB_ID })
        // Another job of the app's is left alone.
        assertTrue(js.allPendingJobs.any { it.id == 1 })
        // And once more on the update itself, with nothing to drop: no error.
        LegacyUpdateJob.cancel(app)
        AppUpdater.resetForTest(null, { it.run() })
    }

    @Test fun `the update broadcast drops the old job too`() {
        val js = app.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        js.schedule(JobInfo.Builder(LegacyUpdateJob.JOB_ID, ComponentName(app, "app.ember.music.UpdateCheckJob"))
            .setPeriodic(6 * 60 * 60 * 1000L).build())
        UpdatedReceiver().onReceive(app, android.content.Intent(android.content.Intent.ACTION_MY_PACKAGE_REPLACED))
        assertFalse(js.allPendingJobs.any { it.id == LegacyUpdateJob.JOB_ID })
    }

    @Test fun `idle counts from when the music stopped or the app left the screen`() {
        // A fresh process: nothing has played this run.
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

    @Test fun `the car's Library shows the update notice on top, and nothing when there is none`() {
        val server = MockWebServer().apply { start() }
        try {
            val api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
            fun library() {
                server.enqueue(MockResponse().setBody("""{"playlists":[]}"""))
            }
            val lib = listOf(BrowseTree.LIKED, BrowseTree.UPLOADS, BrowseTree.DOWNLOADS)
            var ready = false
            val tree = BrowseTree(api, notice = { UpdateRules.carNotice(ready) })
            library()
            assertEquals(lib, tree.children(BrowseTree.LIBRARY).map { it.mediaId })
            ready = true
            library()
            val items = tree.children(BrowseTree.LIBRARY)
            assertEquals(4, items.size)
            val notice = items[0].mediaMetadata
            assertEquals("Ember update ready", notice.title.toString())
            assertTrue(notice.subtitle.toString().contains("parked"))
            assertEquals(false, notice.isPlayable)
            assertEquals(false, notice.isBrowsable)
            assertEquals(BrowseTree.LIKED, items[1].mediaId)
        } finally {
            server.shutdown()
        }
    }

    @Test fun `a notice that fails to build leaves Library as it was`() {
        val server = MockWebServer().apply { start() }
        try {
            val api = ServerApi(server.url("/").toString().trimEnd('/')) { "pb_auth=x" }
            server.enqueue(MockResponse().setBody("""{"playlists":[]}"""))
            val tree = BrowseTree(api, notice = { throw IllegalStateException("updater not ready") })
            assertEquals(listOf(BrowseTree.LIKED, BrowseTree.UPLOADS, BrowseTree.DOWNLOADS), tree.children(BrowseTree.LIBRARY).map { it.mediaId })
        } finally {
            server.shutdown()
        }
    }
}
