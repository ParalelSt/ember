package app.ember.music

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executor

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DiscordDiagnosticsTest {
    private var wasEnabled = false

    @Before fun on() {
        wasEnabled = DiscordDiagnostics.enabled
        DiscordDiagnostics.reset()
        DiscordDiagnostics.enabled = true
    }

    @After fun back() {
        DiscordDiagnostics.reset()
        DiscordDiagnostics.enabled = wasEnabled
    }

    @Test fun `only the newest lines wait, in order`() {
        val q = DiagQueue(max = 3)
        (1..5).forEach { q.add("line $it") }
        assertEquals(listOf("line 3", "line 4", "line 5"), q.take(10))
        assertTrue(q.isEmpty())
    }

    @Test fun `a long line is cut and a newline cannot split it`() {
        val q = DiagQueue(max = 3, maxLine = 10)
        q.add("a".repeat(50) + "\nb")
        val line = q.take(1).single()
        assertEquals(1, line.lines().size)
        assertTrue(line.endsWith("..."))
    }

    @Test fun `take leaves the rest for the next tick`() {
        val q = DiagQueue(max = 10)
        (1..4).forEach { q.add("l$it") }
        assertEquals(listOf("l1", "l2"), q.take(2))
        assertEquals(2, q.size())
    }

    private fun log(sent: MutableList<JSONObject>) = PlaybackLog(
        send = { sent += it },
        online = { true },
        io = Executor { it.run() },
        delay = Delay { _, _ -> ({ }) },
        surface = { Surfaces.PHONE },
        device = JSONObject(),
    )

    private fun events(sent: List<JSONObject>) =
        sent.flatMap { b -> (0 until b.getJSONArray("events").length()).map { b.getJSONArray("events").getJSONObject(it) } }

    @Test fun `lines wait until the log is attached and a cookie exists, then leave as discord diag`() {
        val sent = mutableListOf<JSONObject>()
        val l = log(sent)
        var cookie = false
        DiscordDiagnostics.add("before attach")
        DiscordDiagnostics.attachLog(l) { cookie }
        DiscordDiagnostics.tick()
        assertTrue(sent.isEmpty())
        cookie = true
        DiscordDiagnostics.tick()
        val events = events(sent)
        assertTrue(events.isNotEmpty())
        assertTrue(events.all { it.getString("event") == "discord.diag" })
        assertTrue(events.any { it.getString("message").contains("before attach") })
        DiscordDiagnostics.detachLog(l)
    }

    @Test fun `what is left goes out when the service lets go of its log`() {
        val sent = mutableListOf<JSONObject>()
        val l = log(sent)
        DiscordDiagnostics.attachLog(l) { true }
        DiscordDiagnostics.add("last words")
        DiscordDiagnostics.detachLog(l)
        assertTrue(events(sent).any { it.getString("message").contains("last words") })
        DiscordDiagnostics.add("after detach")
        DiscordDiagnostics.tick()
        assertFalse(events(sent).any { it.getString("message").contains("after detach") })
    }

    @Test fun `a build without the flag sends nothing`() {
        DiscordDiagnostics.enabled = false
        val sent = mutableListOf<JSONObject>()
        val l = log(sent)
        DiscordDiagnostics.attachLog(l) { true }
        DiscordDiagnostics.add("hidden")
        DiscordDiagnostics.addIfChanged("hidden too")
        DiscordDiagnostics.tick()
        assertTrue(sent.isEmpty())
    }

    @Test fun `the same changed line is said once`() {
        val sent = mutableListOf<JSONObject>()
        val l = log(sent)
        DiscordDiagnostics.attachLog(l) { true }
        repeat(3) { DiscordDiagnostics.addIfChanged("same") }
        DiscordDiagnostics.addIfChanged("other")
        DiscordDiagnostics.tick()
        val messages = events(sent).map { it.getString("message") }
        assertEquals(1, messages.count { it.endsWith("same") })
        assertEquals(1, messages.count { it.endsWith("other") })
    }

    @Test fun `environment says what is missing`() {
        assertEquals(
            "env: switch on, app id set, discord installed 300.1, sdk in build, android 34",
            DiagText.environment(true, true, "300.1", true, 34),
        )
        val missing = DiagText.environment(false, false, null, false, 24)
        assertTrue(missing.contains("app id EMPTY"))
        assertTrue(missing.contains("discord NOT installed"))
        assertTrue(missing.contains("sdk NOT in build"))
    }

    @Test fun `an event name the server accepts`() {
        assertTrue(Regex("^[a-z][a-z0-9._-]{0,39}$").matches(DiscordDiagnostics.EVENT))
    }
}
