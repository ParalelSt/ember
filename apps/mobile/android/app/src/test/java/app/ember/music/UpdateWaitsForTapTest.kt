package app.ember.music

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Looper
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetworkCapabilities
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor

/** Owner, 2026-11-13: the Android app no longer fetches or installs an
 *  update by itself. A check only says a newer version is out ("available",
 *  for the page's reminder pill); the download starts with the person's tap
 *  (EmberUpdatePlugin.download / install), and install() then installs it
 *  as soon as it is in. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UpdateWaitsForTapTest {
    private val app = RuntimeEnvironment.getApplication()
    private lateinit var server: MockWebServer
    private val paths = CopyOnWriteArrayList<String>()

    @Before fun setUp() {
        UpdatePresence.reset()
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                paths.add(path)
                return when {
                    path.startsWith("/api/android/update") -> MockResponse().setBody(
                        JSONObject().put("version", "9.9.9").put("url", "/api/android/apk/1").put("size", 64).toString(),
                    )
                    // Not a real APK: the download happens, its check fails.
                    path.startsWith("/api/android/apk/1") -> MockResponse().setBody("not an apk")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val log = PlaybackLog(
            send = { throw IOException("offline") }, online = { false }, io = Executor { it.run() },
            delay = Delay { _, _ -> {} }, surface = { Surfaces.PHONE }, device = JSONObject(),
        )
        // A working Wi-Fi network: the updater only fetches over one.
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = ShadowNetworkCapabilities.newInstance()
        shadowOf(caps).addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, caps)
        AppUpdater.resetForTest(log, Executor { it.run() }, baseUrl = server.url("/").toString().trimEnd('/'))
        AppUpdater.init(app)
    }

    @After fun tearDown() {
        AppUpdater.resetForTest(null, Executor { it.run() })
        UpdatePresence.reset()
        server.shutdown()
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()
    private fun status() = AppUpdater.stateJson().getString("status")
    private fun downloads() = paths.count { it.startsWith("/api/android/apk/") }

    @Test fun `a check only says a newer version is out, it downloads nothing`() {
        AppUpdater.check(manual = true, reason = "manual")
        idle()
        assertEquals("available", status())
        assertEquals("9.9.9", AppUpdater.stateJson().getString("latest"))
        assertEquals(0, downloads())
    }

    @Test fun `the periodic and app-start checks download nothing either`() {
        AppUpdater.check(manual = false, reason = "periodic")
        idle()
        assertEquals("available", status())
        assertEquals(0, downloads())
    }

    @Test fun `a tap fetches the update`() {
        AppUpdater.check(manual = true, reason = "manual")
        idle()
        AppUpdater.downloadNow()
        idle()
        assertEquals(1, downloads())
        // The fake APK fails its checks: the download did happen.
        assertEquals("failed", status())
    }

    @Test fun `install downloads first when nothing is downloaded yet`() {
        AppUpdater.updateNow()
        idle()
        assertTrue(paths.any { it.startsWith("/api/android/update") })
        assertEquals(1, downloads())
        assertFalse(status() == "installing")
    }

    @Test fun `the page's resume note survives the install, and is handed over once`() {
        AppUpdater.keepResume("""{"index":2,"trackId":"youtube:b","at":1}""")
        // A new process: the note is in preferences, not memory.
        AppUpdater.resetForTest(null, Executor { it.run() })
        AppUpdater.init(app)
        assertEquals("""{"index":2,"trackId":"youtube:b","at":1}""", AppUpdater.takeResume())
        assertEquals(null, AppUpdater.takeResume())
    }

    @Test fun `the plugin has download, and install goes through updateNow`() {
        val src = java.io.File("src/main/java/app/ember/music/EmberUpdatePlugin.kt").readText()
        assertTrue(src.contains("fun download(call: PluginCall)"))
        assertTrue(src.contains("AppUpdater.downloadNow()"))
        assertTrue(src.contains("AppUpdater.updateNow()"))
        assertTrue(src.contains("AppUpdater.keepResume(call.getString(\"resume\"))"))
        assertTrue(src.contains("fun takeResume(call: PluginCall)"))
        assertFalse(src.contains("AppUpdater.installNow()"))
    }

    @Test fun `the launch gate leaves an update nobody has to take to the reminder`() {
        val gate = java.io.File("src/main/java/app/ember/music/LaunchGateActivity.kt").readText()
        assertTrue(gate.contains("!GateRules.holdsLaunch(offer) -> null to \"reminder\""))
        assertTrue(gate.contains("AppUpdater.check(manual = true, reason = \"launch\", download = true)"))
    }
}
