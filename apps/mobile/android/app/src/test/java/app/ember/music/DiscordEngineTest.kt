package app.ember.music

import android.os.Looper
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/** The real engine where its library cannot load (a JVM here; a CPU without
 *  it, or a build without the SDK, on a phone), and the manifest's promises.
 *  Passes with and without the SDK present. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DiscordEngineTest {
    @After fun tearDown() = DiscordSharing.reset()

    private val activity = PresenceActivity("Song", "by X", "Album", null, 1_000, 2_000)

    @Test fun `a library that will not load is an answer, not a crash`() {
        val engine = NativeDiscordEngine(1L, 34)
        var result: Triple<Boolean, String?, Boolean>? = null
        engine.update(1, activity) { ok, error, permanent -> result = Triple(ok, error, permanent) }
        val deadline = System.currentTimeMillis() + 10_000
        while (result == null && System.currentTimeMillis() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }
        val r = result
        assertNotNull("no answer", r)
        assertFalse(r!!.first)
        assertTrue(r.third)
    }

    @Test fun `a clear with nothing loaded does nothing`() {
        NativeDiscordEngine(1L, 34).clear()
    }

    @Test fun `status says what stands in the way`() {
        val status = NativeDiscordEngine(1L, 34).status()
        if (!DiscordSdkBridge.PRESENT) {
            assertTrue(status is DiscordStatus.Off)
        } else {
            assertTrue(status is DiscordStatus.Waiting)
            DiscordSharing.activityCreated(Robolectric.buildActivity(android.app.Activity::class.java).get())
            assertEquals(DiscordStatus.Ready, NativeDiscordEngine(1L, 34).status())
        }
    }

    @Test fun `the switch is off until someone says otherwise, and stays on disk`() {
        val app = RuntimeEnvironment.getApplication()
        val prefs = DiscordSharing.prefs(app)
        prefs.edit().clear().commit()
        assertFalse(DiscordSharing.load(prefs))
        DiscordSharing.save(app, true)
        assertTrue(DiscordSharing.load(DiscordSharing.prefs(app)))
    }

    @Test fun `saying the same thing twice wakes nobody`() {
        val app = RuntimeEnvironment.getApplication()
        DiscordSharing.prefs(app).edit().clear().commit()
        var heard = 0
        DiscordSharing.addListener { heard++ }
        DiscordSharing.save(app, true)
        DiscordSharing.save(app, true)
        assertEquals(1, heard)
    }

    @Test fun `what the SDK would bring for voice and sign-in is taken out of the manifest`() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        for (name in listOf(
            "android.permission.FOREGROUND_SERVICE_MICROPHONE",
            "android.permission.MODIFY_AUDIO_SETTINGS",
            "android.permission.BLUETOOTH",
            "android.permission.BLUETOOTH_CONNECT",
        )) {
            assertTrue(name, Regex("""<uses-permission android:name="$name" tools:node="remove" />""").containsMatchIn(manifest))
        }
        for (name in listOf("com.discord.socialsdk.AuthenticationActivity", "com.discord.socialsdk.ForegroundService")) {
            assertTrue(name, Regex("""android:name="$name"\s+tools:node="remove"""").containsMatchIn(manifest))
        }
    }
}
