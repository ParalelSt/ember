package app.ember.music

import app.ember.music.GateRules.Effect
import app.ember.music.GateRules.History
import app.ember.music.GateRules.Input
import app.ember.music.GateRules.LaunchFacts
import app.ember.music.GateRules.Machine
import app.ember.music.GateRules.Mode
import app.ember.music.GateRules.Offer
import app.ember.music.GateRules.Phase
import app.ember.music.GateRules.Skip
import app.ember.music.GateRules.Stage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The launch gate's decisions (GateRules): when a launch is gated, what the
 *  server's answer means, every step of the dialog, the launch history, and
 *  the copy. The desktop gate (src/gate.rs) is tested the same way. */
@RunWith(RobolectricTestRunner::class) // real org.json
class GateRulesTest {
    private val main = "android.intent.action.MAIN"
    private val launcher = setOf("android.intent.category.LAUNCHER")
    private fun facts(
        action: String? = main, categories: Set<String> = launcher,
        automotive: Boolean = false, car: Boolean = false, playing: Boolean = false,
    ) = LaunchFacts(action, categories, automotive, car, playing)

    private fun offer(v: String = "0.4.23", mandatory: Boolean = false, reason: String? = null, size: Long? = 18_000_000) =
        Offer(v, mandatory, reason, size)

    private fun shown(m: Machine, o: Offer = offer(), ready: Boolean = false) = m.handle(Input.Checked(o, ready))
    private fun events(fx: List<Effect>) = fx.filterIsInstance<Effect.Event>().map { it.name }

    // ── When to gate ────────────────────────────────────────────────────

    @Test fun `a launcher tap is gated`() {
        assertNull(GateRules.skip(facts()))
    }

    @Test fun `never in a car, an Android car, or with music already playing`() {
        assertEquals(Skip.AUTOMOTIVE, GateRules.skip(facts(automotive = true)))
        assertEquals(Skip.CAR, GateRules.skip(facts(car = true)))
        assertEquals(Skip.PLAYING, GateRules.skip(facts(playing = true)))
    }

    @Test fun `never for anything but a launcher tap`() {
        assertEquals(Skip.NOT_LAUNCHER, GateRules.skip(facts(action = "android.intent.action.VIEW")))
        assertEquals(Skip.NOT_LAUNCHER, GateRules.skip(facts(categories = emptySet())))
        assertEquals(Skip.NOT_LAUNCHER, GateRules.skip(facts(action = null)))
    }

    // ── The server's answer ─────────────────────────────────────────────

    @Test fun `reads an install offer, with mandatory, reason and size`() {
        val o = GateRules.parseAnswer(JSONObject("""{"update":{"version":"0.4.23","mandatory":true,"reason":"min-version","action":"install","size":18000000,"url":null}}"""), "0.4.22")!!
        assertEquals(Offer("0.4.23", true, "min-version", 18_000_000), o)
    }

    @Test fun `no offer, an older one, a broken one or a download page is no update`() {
        assertNull(GateRules.parseAnswer(JSONObject("""{"update":null}"""), "0.4.22"))
        assertNull(GateRules.parseAnswer(JSONObject("""{"update":{"version":"0.4.22","action":"install"}}"""), "0.4.22"))
        assertNull(GateRules.parseAnswer(JSONObject("""{"update":{"version":"0.4.9","action":"install"}}"""), "0.4.10"))
        assertNull(GateRules.parseAnswer(JSONObject("""{"update":{"version":"banana","action":"install"}}"""), "0.4.22"))
        assertNull(GateRules.parseAnswer(JSONObject("""{"update":{"version":"0.5.0","action":"download-page","url":"https://x"}}"""), "0.4.22"))
        assertNull(GateRules.parseAnswer(null, "0.4.22"))
        val plain = GateRules.parseAnswer(JSONObject("""{"update":{"version":"0.5.0","action":"install"}}"""), "0.4.22")!!
        assertFalse(plain.mandatory)
        assertNull(plain.reason)
        assertNull(plain.size)
    }

    @Test fun `asks the shared endpoint as an android apk at launch`() {
        assertEquals("/api/app/update?platform=android&version=0.4.22&install=apk&launch=1", GateRules.checkPath("0.4.22"))
    }

    // ── The dialog ──────────────────────────────────────────────────────

    @Test fun `no update opens the app`() {
        val m = Machine(recovery = false, resumed = true)
        assertEquals(listOf(Effect.EnterApp), m.handle(Input.Checked(null, ready = false)))
        assertEquals(Phase.Done, m.phase)
    }

    @Test fun `an update downloads with the dialog up`() {
        val m = Machine(false, true)
        val fx = shown(m)
        assertTrue(Effect.StartDownload in fx)
        assertEquals(listOf("update.gate.shown"), events(fx))
        assertEquals(Phase.Downloading(null), m.phase)
        m.handle(Input.Progress(42))
        assertEquals(Phase.Downloading(42), m.phase)
        m.handle(Input.Downloaded)
        assertEquals(Phase.Countdown(7, held = false), m.phase)
    }

    @Test fun `an APK that already waits goes straight to the countdown`() {
        val m = Machine(false, true)
        assertFalse(Effect.StartDownload in shown(m, ready = true))
        assertEquals(Phase.Countdown(GateRules.COUNTDOWN_S, false), m.phase)
    }

    @Test fun `seven seconds, then it installs`() {
        assertEquals(7, GateRules.COUNTDOWN_S)
        val m = Machine(false, true)
        shown(m, ready = true)
        repeat(6) { assertTrue(m.handle(Input.Tick).isEmpty()) }
        assertEquals(Phase.Countdown(1, false), m.phase)
        val fx = m.handle(Input.Tick)
        assertTrue(Effect.Install in fx)
        assertEquals(Phase.Installing, m.phase)
    }

    @Test fun `Not now opens the app from the download and the countdown`() {
        for (ready in listOf(false, true)) {
            val m = Machine(false, true)
            shown(m, ready = ready)
            val fx = m.handle(Input.NotNow)
            assertTrue(Effect.EnterApp in fx)
            assertEquals(listOf("update.gate.cancel"), events(fx))
        }
    }

    @Test fun `Update now installs from the countdown, or as soon as the download is in`() {
        val c = Machine(false, true)
        shown(c, ready = true)
        assertTrue(Effect.Install in c.handle(Input.UpdateNow))
        val d = Machine(false, true)
        shown(d)
        assertTrue(d.handle(Input.UpdateNow).isEmpty())
        assertTrue(d.updateNow)
        assertTrue(Effect.Install in d.handle(Input.Downloaded))
    }

    @Test fun `leaving the gate opens the app instead of installing`() {
        val m = Machine(false, true)
        shown(m, ready = true)
        val fx = m.handle(Input.Resumed(false))
        assertTrue(Effect.EnterApp in fx)
        assertEquals(true, (fx.first() as Effect.Event).data["focusLost"])
    }

    @Test fun `a required update has Quit Ember, no Not now, and waits for the person`() {
        val m = Machine(false, true)
        shown(m, offer(mandatory = true, reason = "flagged"), ready = true)
        assertTrue(m.handle(Input.NotNow).isEmpty())
        assertTrue(m.handle(Input.Resumed(false)).isEmpty())
        assertEquals(Phase.Countdown(7, held = true), m.phase)
        repeat(20) { assertFalse(Effect.Install in m.handle(Input.Tick)) }
        m.handle(Input.Resumed(true))
        assertEquals(Phase.Countdown(7, held = false), m.phase)
        assertTrue(Effect.Quit in m.handle(Input.Quit))
        assertEquals(Phase.Done, m.phase)
    }

    @Test fun `Quit does nothing for an update that is not required`() {
        val m = Machine(false, true)
        shown(m)
        assertTrue(m.handle(Input.Quit).isEmpty())
    }

    @Test fun `no install permission asks for it, and Settings does not count as leaving`() {
        val m = Machine(false, true)
        shown(m, ready = true)
        m.handle(Input.UpdateNow)
        m.handle(Input.NeedsPermission)
        assertEquals(Phase.Permission, m.phase)
        assertEquals(listOf(Effect.OpenPermissionSettings), m.handle(Input.UpdateNow))
        assertTrue(m.handle(Input.Resumed(false)).isEmpty())
        assertEquals(Phase.Permission, m.phase)
        // Back from Settings: try again.
        assertTrue(Effect.Install in m.handle(Input.Resumed(true)))
        // Or the person gives up.
        m.handle(Input.NeedsPermission)
        assertTrue(Effect.EnterApp in m.handle(Input.NotNow))
    }

    @Test fun `Android's confirm screen over the gate does not cancel the install`() {
        val m = Machine(false, true)
        shown(m, ready = true)
        m.handle(Input.UpdateNow)
        assertTrue(m.handle(Input.Resumed(false)).isEmpty())
        assertTrue(m.handle(Input.NotNow).isEmpty())
        assertEquals(Phase.Installing, m.phase)
    }

    @Test fun `a failed download or install says so, then opens the app, required or not`() {
        for (mandatory in listOf(false, true)) {
            val d = Machine(false, true)
            shown(d, offer(mandatory = mandatory))
            assertTrue(Effect.Linger in d.handle(Input.DownloadFailed))
            assertEquals(Phase.Failed, d.phase)
            assertTrue(Effect.EnterApp in d.handle(Input.FailedTimeout))

            val i = Machine(false, true)
            shown(i, offer(mandatory = mandatory), ready = true)
            i.handle(Input.UpdateNow)
            assertTrue(Effect.Linger in i.handle(Input.InstallFailed))
        }
    }

    @Test fun `the updater's state drives the dialog`() {
        assertEquals(Input.Progress(42), GateRules.fromUpdater(Phase.Downloading(null), "downloading", null, 0.42))
        assertEquals(Input.Downloaded, GateRules.fromUpdater(Phase.Downloading(10), "ready", null, null, "0.4.23", "0.4.23"))
        assertNull(GateRules.fromUpdater(Phase.Downloading(10), "ready", null, null, "0.4.21", "0.4.23"))
        assertEquals(Input.DownloadFailed, GateRules.fromUpdater(Phase.Downloading(10), "failed", null, null))
        assertEquals(Input.DownloadFailed, GateRules.fromUpdater(Phase.Downloading(10), "up-to-date", null, null))
        assertNull(GateRules.fromUpdater(Phase.Installing, "installing", null, null))
        assertEquals(Input.NeedsPermission, GateRules.fromUpdater(Phase.Installing, "ready", "permission", null))
        assertEquals(Input.InstallFailed, GateRules.fromUpdater(Phase.Installing, "ready", "tap", null))
        assertNull(GateRules.fromUpdater(Phase.Countdown(5, false), "ready", null, null))
    }

    // ── Launch history ──────────────────────────────────────────────────

    @Test fun `two launches that died after the gate make a recovery launch`() {
        var h = History(Stage.READY, lastVersion = "0.4.22")
        var l = GateRules.onLaunch(h, "0.4.22")
        assertEquals(Mode.NORMAL, l.mode)
        h = GateRules.reached(l.history, Stage.GATED) // died after the gate
        l = GateRules.onLaunch(h, "0.4.22")
        assertEquals(Mode.NORMAL, l.mode)
        h = GateRules.reached(l.history, Stage.GATED)
        l = GateRules.onLaunch(h, "0.4.22")
        assertEquals(Mode.RECOVERY, l.mode)
    }

    @Test fun `two launches that died in the gate skip it the next time`() {
        val l1 = GateRules.onLaunch(History(Stage.STARTING), "0.4.22")
        assertEquals(Mode.NORMAL, l1.mode)
        val l2 = GateRules.onLaunch(l1.history, "0.4.22")
        assertEquals(Mode.SKIP_GATE, l2.mode)
    }

    @Test fun `a launch that worked starts the count over, quitting on purpose changes nothing`() {
        val bad = History(Stage.STARTING, failedInGate = 1, failedAfterGate = 1)
        assertEquals(History(Stage.READY, 0, 0), GateRules.reached(bad, Stage.READY))
        val clean = GateRules.onLaunch(History(Stage.CLEAN, 1, 1), "0.4.22")
        assertEquals(Mode.NORMAL, clean.mode)
        assertEquals(1, clean.history.failedInGate)
    }

    @Test fun `notices an update went in since the last launch`() {
        assertEquals("0.4.22", GateRules.onLaunch(History(Stage.CLEAN, lastVersion = "0.4.22"), "0.4.23").updatedFrom)
        assertNull(GateRules.onLaunch(History(Stage.READY, lastVersion = "0.4.23"), "0.4.23").updatedFrom)
        assertNull(GateRules.onLaunch(History(), "0.4.23").updatedFrom)
    }

    @Test fun `the relaunch notice is only for an install the gate started just now`() {
        assertTrue(GateHistory.relaunchNoticeDue(now = 100_000, installAt = 40_000))
        assertFalse(GateHistory.relaunchNoticeDue(now = 100_000, installAt = 0))
        assertFalse(GateHistory.relaunchNoticeDue(now = 11 * 60_000 + 1_000, installAt = 1_000))
        assertFalse(GateHistory.relaunchNoticeDue(now = 1_000, installAt = 5_000))
    }

    // ── Copy ────────────────────────────────────────────────────────────

    @Test fun `the copy follows the owner's picks`() {
        val m = Machine(false, true)
        assertNull(GateRules.copy(m, silent = true))
        shown(m)
        var c = GateRules.copy(m, true)!!
        assertEquals("Updating Ember", c.title)
        assertEquals("Version 0.4.23 · 17 MB", c.detail)
        assertEquals("Not now", c.cancel)
        assertEquals("Update now", c.primary)
        assertEquals(-1, c.progress)
        m.handle(Input.Progress(42))
        assertEquals("Version 0.4.23 · 42% of 17 MB", GateRules.copy(m, true)!!.detail)
        m.handle(Input.Downloaded)
        c = GateRules.copy(m, true)!!
        assertEquals("Restarting in 7s", c.title)
        assertEquals("Version 0.4.23 is ready", c.detail)
        m.handle(Input.UpdateNow)
        c = GateRules.copy(m, true)!!
        assertEquals("Installing update", c.title)
        assertFalse(c.buttons)
        assertEquals("Android will ask you to confirm", GateRules.copy(m, false)!!.detail)
    }

    @Test fun `a required update has a one-line reason and Quit Ember`() {
        val m = Machine(false, true)
        shown(m, offer(mandatory = true, reason = "min-version"))
        val c = GateRules.copy(m, true)!!
        assertEquals("Ember needs an update", c.title)
        assertEquals("This version no longer works with the server.", c.reason)
        assertEquals("Quit Ember", c.cancel)
        val f = Machine(false, true)
        shown(f, offer(mandatory = true, reason = "flagged"))
        assertEquals("This update fixes a serious problem.", GateRules.copy(f, true)!!.reason)
    }

    @Test fun `recovery and permission copy`() {
        val r = Machine(recovery = true, resumed = true)
        shown(r)
        val c = GateRules.copy(r, true)!!
        assertEquals("Getting a fix", c.title)
        assertEquals("Ember didn't start properly last time.", c.reason)
        assertEquals("Not now", c.cancel)

        val p = Machine(false, true)
        shown(p, ready = true)
        p.handle(Input.UpdateNow)
        p.handle(Input.NeedsPermission)
        val pc = GateRules.copy(p, true)!!
        assertEquals("Allow Ember to install updates", pc.title)
        assertEquals("Allow", pc.primary)
    }

    @Test fun `no copy has an em dash`() {
        val src = java.io.File("src/main/java/app/ember/music/GateRules.kt").readText()
        assertFalse(src.contains('\u2014'))
    }
}
