package app.ember.music

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files

/** A download list the phone cannot save (a full disk, the very moment
 *  people download for offline) used to crash the whole app, music and all:
 *  OfflineStore.save() rethrows so the caller knows, the plugin method let it
 *  out, and Capacitor rethrows whatever a plugin method throws on its own
 *  thread. The call is rejected with the reason instead. */
@RunWith(RobolectricTestRunner::class)
// Below 33: pin() asks for the notification permission there, which needs a
// bridge this test has none of.
@Config(sdk = [28])
class OfflinePluginSaveFailTest {
    private lateinit var plugin: EmberOfflinePlugin
    private lateinit var store: OfflineStore

    private class Call(data: JSObject) : PluginCall(null, "EmberOffline", "cb", "m", data) {
        var rejected: String? = null
        var resolved = false
        override fun resolve(data: JSObject?) { resolved = true }
        override fun resolve() { resolved = true }
        override fun reject(msg: String?, code: String?, ex: Exception?, data: JSObject?) { rejected = msg }
    }

    private fun track(id: String) = JSObject("""{"id":"$id","title":"T","artist":"A","streamUrl":"/api/youtube/stream/x"}""")

    @Before fun setUp() {
        val root = Files.createTempDirectory("offline").toFile()
        store = OfflineStore(root)
        store.upsertPin("p1", "One", listOf(track("youtube:a")))
        // From here on every index write fails: index.json.tmp is a directory.
        File(root, "index.json.tmp").mkdirs()
        plugin = EmberOfflinePlugin()
        EmberOfflinePlugin::class.java.getDeclaredField("store\$delegate").apply { isAccessible = true }.set(plugin, lazyOf(store))
        NativeLog.reset()
    }

    @After fun tearDown() {
        NativeLog.reset()
        OfflineDownloadService.cancelled.clear()
    }

    @Test fun `a pin that cannot be saved is rejected, not a crash`() {
        val call = Call(JSObject().put("id", "p2").put("name", "Two").put("tracks", JSArray().put(track("youtube:b"))))
        plugin.pin(call)
        assertNotNull(call.rejected)
    }

    @Test fun `an unpin or clear all that cannot be saved is rejected, not a crash`() {
        Call(JSObject().put("id", "p1")).also { plugin.unpin(it); assertNotNull(it.rejected) }
        Call(JSObject()).also { plugin.clearAll(it); assertNotNull(it.rejected) }
    }

    @Test fun `a track list with a non-track in it is rejected, not a crash`() {
        val call = Call(JSObject().put("id", "p3").put("name", "Three").put("tracks", JSArray().put("not a track")))
        plugin.pin(call)
        assertEquals("tracks must be songs", call.rejected)
    }
}
