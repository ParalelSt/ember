package app.ember.music

import app.ember.music.UpdateRules.Archive
import app.ember.music.UpdateRules.Decision
import app.ember.music.UpdateRules.InstallFacts
import app.ember.music.UpdateRules.Installed
import app.ember.music.UpdateRules.NetFacts
import app.ember.music.UpdateRules.Verdict
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The in-app updater's decisions (UpdateRules): which release is newer,
 *  which networks may download it, which APK may install, and when. */
@RunWith(RobolectricTestRunner::class) // real org.json
class UpdateRulesTest {
    // ── Versions ────────────────────────────────────────────────────────

    @Test fun `versions compare number by number`() {
        assertTrue(UpdateRules.isNewer("0.4.19", "0.4.18"))
        assertTrue(UpdateRules.isNewer("0.4.10", "0.4.9"))
        assertTrue(UpdateRules.isNewer("0.5.0", "0.4.99"))
        assertTrue(UpdateRules.isNewer("1.0.0", "0.9.9"))
        assertTrue(UpdateRules.isNewer("v0.4.19", "0.4.18"))
        assertFalse(UpdateRules.isNewer("0.4.18", "0.4.18"))
        assertFalse(UpdateRules.isNewer("0.4.9", "0.4.10"))
        assertFalse(UpdateRules.isNewer("0.3.99", "0.4.0"))
    }

    @Test fun `an unparseable offer is never newer, an unknown current version is behind`() {
        assertFalse(UpdateRules.isNewer("banana", "0.4.18"))
        assertFalse(UpdateRules.isNewer(null, "0.4.18"))
        assertFalse(UpdateRules.isNewer("0.4", "0.3.0"))
        assertTrue(UpdateRules.isNewer("0.4.19", null))
        assertNull(UpdateRules.parseVersion("1.2.3.4"))
        assertEquals(listOf(0, 4, 18), UpdateRules.parseVersion(" v0.4.18 "))
    }

    @Test fun `the feed's offer is read, and a broken one is no offer`() {
        val sha = "ab".repeat(32)
        val feed = UpdateRules.parseFeed(JSONObject("""{"version":"0.4.19","versionCode":null,"url":"/api/android/apk/7","size":123,"sha256":"${sha.uppercase()}"}"""))!!
        assertEquals("0.4.19", feed.version)
        assertNull(feed.versionCode)
        assertEquals("/api/android/apk/7", feed.url)
        assertEquals(123L, feed.size)
        assertEquals(sha, feed.sha256)
        assertEquals(24L, UpdateRules.parseFeed(JSONObject("""{"version":"0.4.19","versionCode":24,"url":"/x"}"""))!!.versionCode)
        assertNull(UpdateRules.parseFeed(JSONObject("""{"version":"0.4.19","url":"/x","sha256":"short"}"""))!!.sha256)
        assertNull(UpdateRules.parseFeed(JSONObject("""{"version":"latest","url":"/x"}""")))
        assertNull(UpdateRules.parseFeed(JSONObject("""{"version":"0.4.19"}""")))
        assertNull(UpdateRules.parseFeed(null))
    }

    @Test fun `a known versionCode settles it, otherwise the version name does`() {
        val f = UpdateRules.Feed("0.4.19", null, "/x", 1, null)
        assertTrue(UpdateRules.offerIsNewer(f, "0.4.18", 23))
        assertFalse(UpdateRules.offerIsNewer(f, "0.4.19", 24))
        assertFalse(UpdateRules.offerIsNewer(f.copy(versionCode = 23), "0.4.18", 23))
        assertTrue(UpdateRules.offerIsNewer(f.copy(versionCode = 24), "0.4.18", 23))
    }

    // ── Network ─────────────────────────────────────────────────────────

    private fun net(internet: Boolean = true, validated: Boolean = true, wifi: Boolean = false, cellular: Boolean = false, ethernet: Boolean = false) =
        NetFacts(internet, validated, wifi, cellular, ethernet)

    @Test fun `downloads on working Wi-Fi, mobile data or ethernet`() {
        assertTrue(UpdateRules.canDownload(net(wifi = true)))
        assertTrue(UpdateRules.canDownload(net(cellular = true)))
        assertTrue(UpdateRules.canDownload(net(ethernet = true)))
    }

    @Test fun `waits when offline, behind a captive portal, or on another transport`() {
        assertFalse(UpdateRules.canDownload(null))
        assertFalse(UpdateRules.canDownload(net(validated = false, wifi = true)))
        assertFalse(UpdateRules.canDownload(net(internet = false, cellular = true)))
        assertFalse(UpdateRules.canDownload(net()))
    }

    // ── The downloaded APK ──────────────────────────────────────────────

    private val key = "11".repeat(32)
    private val other = "22".repeat(32)
    private val installed = Installed(versionCode = 23, signers = setOf(key))
    private fun apk(pkg: String? = UpdateRules.PACKAGE, code: Long = 24, signers: Set<String> = setOf(key), history: Set<String> = emptySet()) =
        Archive(pkg, code, signers, history)

    @Test fun `signatures match only on the same key`() {
        assertTrue(UpdateRules.signaturesMatch(setOf(key), setOf(key)))
        assertFalse(UpdateRules.signaturesMatch(setOf(key), setOf(other)))
        assertFalse(UpdateRules.signaturesMatch(emptySet(), emptySet()))
        assertFalse(UpdateRules.signaturesMatch(setOf(key), emptySet()))
        assertFalse(UpdateRules.signaturesMatch(setOf(key), setOf(key, other)))
    }

    @Test fun `a rotated key passes when the installed key is in the new lineage`() {
        assertTrue(UpdateRules.signaturesMatch(setOf(key), setOf(other), archiveHistory = setOf(key, other)))
        assertFalse(UpdateRules.signaturesMatch(setOf(key), setOf(other), archiveHistory = setOf(other)))
    }

    @Test fun `the next Ember, signed with the same key, is accepted`() {
        assertEquals(Verdict.OK, UpdateRules.verify(apk(), installed))
        assertEquals(Verdict.OK, UpdateRules.verify(apk(), installed, expectedSha256 = "AB".repeat(32), actualSha256 = "ab".repeat(32)))
    }

    @Test fun `anything else is refused, and says why`() {
        assertEquals(Verdict.UNREADABLE, UpdateRules.verify(null, installed))
        assertEquals(Verdict.WRONG_PACKAGE, UpdateRules.verify(apk(pkg = "com.evil.app"), installed))
        assertEquals(Verdict.WRONG_PACKAGE, UpdateRules.verify(apk(pkg = null), installed))
        assertEquals(Verdict.NOT_NEWER, UpdateRules.verify(apk(code = 23), installed))
        assertEquals(Verdict.NOT_NEWER, UpdateRules.verify(apk(code = 5), installed))
        assertEquals(Verdict.SIGNATURE_MISMATCH, UpdateRules.verify(apk(signers = setOf(other)), installed))
        assertEquals(Verdict.HASH_MISMATCH, UpdateRules.verify(apk(), installed, expectedSha256 = "ab".repeat(32), actualSha256 = "cd".repeat(32)))
    }

    @Test fun `only a refusal a new download cannot fix is remembered`() {
        assertTrue(UpdateRules.isPermanent(Verdict.WRONG_PACKAGE))
        assertTrue(UpdateRules.isPermanent(Verdict.NOT_NEWER))
        assertTrue(UpdateRules.isPermanent(Verdict.SIGNATURE_MISMATCH))
        assertFalse(UpdateRules.isPermanent(Verdict.HASH_MISMATCH))
        assertFalse(UpdateRules.isPermanent(Verdict.UNREADABLE))
        assertFalse(UpdateRules.isPermanent(Verdict.OK))
    }

    @Test fun `music meant to play counts as playing through a call, a nav prompt or buffering`() {
        val idle = androidx.media3.common.Player.STATE_IDLE
        val buffering = androidx.media3.common.Player.STATE_BUFFERING
        val ready = androidx.media3.common.Player.STATE_READY
        val ended = androidx.media3.common.Player.STATE_ENDED
        assertTrue(UpdateRules.meansPlaying(true, ready))
        assertTrue(UpdateRules.meansPlaying(true, buffering))
        assertFalse(UpdateRules.meansPlaying(false, ready))
        assertFalse(UpdateRules.meansPlaying(true, idle))
        assertFalse(UpdateRules.meansPlaying(true, ended))
    }

    // ── Installing ──────────────────────────────────────────────────────

    @Test fun `silent only on Android 12+ with Ember as the installer of record`() {
        assertTrue(UpdateRules.silentLikely(31, "app.ember.music"))
        assertTrue(UpdateRules.silentLikely(35, "app.ember.music"))
        assertFalse(UpdateRules.silentLikely(30, "app.ember.music"))
        assertFalse(UpdateRules.silentLikely(34, "com.android.chrome"))
        assertFalse(UpdateRules.silentLikely(34, null))
    }

    private fun facts(car: Boolean = false, tapped: Boolean = false, canInstall: Boolean = true) =
        InstallFacts(car, tapped, canInstall)

    @Test fun `never installs without a tap, in any combination of facts`() {
        val bools = listOf(false, true)
        for (car in bools) for (canInstall in bools) {
            val d = UpdateRules.decide(facts(car = car, tapped = false, canInstall = canInstall))
            assertNotEquals("car=$car canInstall=$canInstall", Decision.INSTALL, d)
        }
    }

    @Test fun `without a tap an update that can install just waits for one`() {
        assertEquals(Decision.ASK_USER, UpdateRules.decide(facts()))
    }

    @Test fun `a tap installs`() {
        assertEquals(Decision.INSTALL, UpdateRules.decide(facts(tapped = true)))
    }

    @Test fun `never during a car session, not even on a tap`() {
        assertEquals(Decision.WAIT_CAR, UpdateRules.decide(facts(car = true)))
        assertEquals(Decision.WAIT_CAR, UpdateRules.decide(facts(car = true, tapped = true)))
    }

    @Test fun `without the install permission the page offers the setting`() {
        assertEquals(Decision.NEED_PERMISSION, UpdateRules.decide(facts(canInstall = false)))
        assertEquals(Decision.NEED_PERMISSION, UpdateRules.decide(facts(canInstall = false, tapped = true)))
        // The car still comes first: nothing to read about settings while driving.
        assertEquals(Decision.WAIT_CAR, UpdateRules.decide(facts(canInstall = false, car = true)))
    }

    @Test fun `a check is due on a first run, after the gap, or when the clock went back`() {
        assertTrue(UpdateRules.checkDue(now = 1_000, lastCheck = 0, minGapMs = 60_000))
        assertFalse(UpdateRules.checkDue(now = 50_000, lastCheck = 1_000, minGapMs = 60_000))
        assertTrue(UpdateRules.checkDue(now = 61_000, lastCheck = 1_000, minGapMs = 60_000))
        assertTrue(UpdateRules.checkDue(now = 500, lastCheck = 1_000, minGapMs = 60_000))
    }

    @Test fun `the car hears about an update only once it is ready`() {
        assertNull(UpdateRules.carNotice(false))
        val (title, subtitle) = UpdateRules.carNotice(true)!!
        assertEquals("Ember update ready", title)
        assertTrue(subtitle.contains("parked"))
        assertTrue(subtitle.contains("open Ember on your phone"))
        assertFalse(subtitle.contains("Installs when"))
    }

    @Test fun `before Android 10 the updated app opens itself again, from 10 on Android forbids it`() {
        assertTrue(UpdateRules.relaunchDirectly(23))
        assertTrue(UpdateRules.relaunchDirectly(28))
        assertFalse(UpdateRules.relaunchDirectly(29))
        assertFalse(UpdateRules.relaunchDirectly(35))
    }

    @Test fun `notifications are asked for before an update only where Android needs the permission`() {
        assertTrue(UpdateRules.askNotificationsFirst(sdk = 33, granted = false))
        assertTrue(UpdateRules.askNotificationsFirst(sdk = 35, granted = false))
        assertFalse(UpdateRules.askNotificationsFirst(sdk = 35, granted = true))
        assertFalse(UpdateRules.askNotificationsFirst(sdk = 32, granted = false))
    }

    @Test fun `Settings drops back to tap to install as soon as the confirm screen is left`() {
        assertTrue(UpdateRules.unstickNow(force = false, confirmShown = true, gateInstall = false))
        assertFalse(UpdateRules.unstickNow(force = false, confirmShown = false, gateInstall = false))
    }

    @Test fun `the launch gate waits for Android's answer after the confirm screen`() {
        assertFalse(UpdateRules.unstickNow(force = false, confirmShown = true, gateInstall = true))
    }

    @Test fun `past the 60 s limit the wait ends for the gate and for Settings`() {
        assertTrue(UpdateRules.unstickNow(force = true, confirmShown = true, gateInstall = true))
        assertTrue(UpdateRules.unstickNow(force = true, confirmShown = false, gateInstall = true))
        assertTrue(UpdateRules.unstickNow(force = true, confirmShown = false, gateInstall = false))
    }
}
