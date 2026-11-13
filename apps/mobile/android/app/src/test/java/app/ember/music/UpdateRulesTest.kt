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

    @Test fun `leaving the confirm screen is not an answer, for Settings and the gate alike`() {
        // Session alive (confirm, a vendor scan, Play Protect): keep waiting,
        // however long it has been short of the backstop.
        assertFalse(UpdateRules.unstickNow(staging = false, sessionAlive = true, sinceActivityMs = 0, goneForMs = 0))
        assertFalse(UpdateRules.unstickNow(staging = false, sessionAlive = true, sinceActivityMs = 5 * 60_000, goneForMs = 0))
        // The old 60 s limit is gone.
        assertFalse(UpdateRules.unstickNow(staging = false, sessionAlive = true, sinceActivityMs = 61_000, goneForMs = 0))
    }

    @Test fun `the APK still being staged is never stuck short of the backstop`() {
        assertFalse(UpdateRules.unstickNow(staging = true, sessionAlive = false, sinceActivityMs = 90_000, goneForMs = 0))
    }

    @Test fun `a session gone with no answer ends the install after a short grace`() {
        assertFalse(UpdateRules.unstickNow(staging = false, sessionAlive = false, sinceActivityMs = 1_000, goneForMs = 0))
        assertFalse(UpdateRules.unstickNow(staging = false, sessionAlive = false, sinceActivityMs = 1_000, goneForMs = UpdateRules.SESSION_GONE_GRACE_MS - 1))
        assertTrue(UpdateRules.unstickNow(staging = false, sessionAlive = false, sinceActivityMs = 1_000, goneForMs = UpdateRules.SESSION_GONE_GRACE_MS))
    }

    @Test fun `no sign of life for the backstop ends the wait whatever the session says`() {
        val b = UpdateRules.INSTALL_BACKSTOP_MS
        assertTrue(UpdateRules.unstickNow(staging = false, sessionAlive = true, sinceActivityMs = b, goneForMs = 0))
        assertTrue(UpdateRules.unstickNow(staging = true, sessionAlive = false, sinceActivityMs = b, goneForMs = 0))
        assertTrue(b >= 10 * 60_000L)
    }

    // ── Android's answers ───────────────────────────────────────────────

    @Test fun `an answer is described with its status name, number and message`() {
        assertEquals("aborted (3): INSTALL_FAILED_VERIFICATION_FAILURE", UpdateRules.describeStatus(3, "INSTALL_FAILED_VERIFICATION_FAILURE"))
        assertEquals("incompatible (7): INSTALL_FAILED_USER_RESTRICTED: Install canceled by user",
            UpdateRules.describeStatus(7, " INSTALL_FAILED_USER_RESTRICTED: Install canceled by user "))
        assertEquals("pending-user-action (-1)", UpdateRules.describeStatus(-1, ""))
        assertEquals("success (0)", UpdateRules.describeStatus(0, null))
        assertEquals("failure (1)", UpdateRules.describeStatus(1, null))
        assertEquals("blocked (2)", UpdateRules.describeStatus(2, null))
        assertEquals("invalid (4)", UpdateRules.describeStatus(4, null))
        assertEquals("conflict (5)", UpdateRules.describeStatus(5, null))
        assertEquals("storage (6)", UpdateRules.describeStatus(6, null))
        assertEquals("timeout (8)", UpdateRules.describeStatus(8, null))
        assertEquals("status 42 (42): x", UpdateRules.describeStatus(42, "x"))
    }

    @Test fun `only a no on Android's own screen counts as a plain cancel`() {
        assertTrue(UpdateRules.isPlainCancel(3, "INSTALL_FAILED_ABORTED: User rejected permissions"))
        assertTrue(UpdateRules.isPlainCancel(3, ""))
        assertTrue(UpdateRules.isPlainCancel(3, "INSTALL_FAILED_ABORTED"))
        // Play Protect or a verifier stopping it is not the person's no.
        assertFalse(UpdateRules.isPlainCancel(3, "INSTALL_FAILED_VERIFICATION_FAILURE"))
        assertFalse(UpdateRules.isPlainCancel(3, "INSTALL_FAILED_VERIFICATION_TIMEOUT: rejected by verifier"))
        assertFalse(UpdateRules.isPlainCancel(3, "Session was abandoned"))
        // Only ABORTED is ever a cancel.
        assertFalse(UpdateRules.isPlainCancel(7, "INSTALL_FAILED_USER_RESTRICTED: Install canceled by user"))
    }

    @Test fun `only an answer for the session this install committed counts`() {
        assertTrue(UpdateRules.isCurrentSession(current = 7, incoming = 7))
        assertFalse(UpdateRules.isCurrentSession(current = 7, incoming = 6))
        assertFalse(UpdateRules.isCurrentSession(current = 7, incoming = -1))
        assertFalse(UpdateRules.isCurrentSession(current = null, incoming = 7))
        assertFalse(UpdateRules.isCurrentSession(current = null, incoming = -1))
    }

    // ── Reusing a session ───────────────────────────────────────────────

    private val backstop = UpdateRules.INSTALL_BACKSTOP_MS

    @Test fun `a session is in progress while Android has it and it showed life within the backstop`() {
        assertTrue(UpdateRules.sessionInProgress(alive = true, sinceActivityMs = 0))
        assertTrue(UpdateRules.sessionInProgress(alive = true, sinceActivityMs = backstop - 1))
        assertTrue(UpdateRules.sessionInProgress(alive = true, sinceActivityMs = -5_000)) // clock went back
        assertFalse(UpdateRules.sessionInProgress(alive = true, sinceActivityMs = backstop))
        assertFalse(UpdateRules.sessionInProgress(alive = false, sinceActivityMs = 0))
    }

    @Test fun `a new install abandons leftovers and stuck sessions, never the one in progress`() {
        assertFalse(UpdateRules.mayAbandon(id = 7, current = 7, currentInProgress = true))
        assertTrue(UpdateRules.mayAbandon(id = 7, current = 7, currentInProgress = false))
        assertTrue(UpdateRules.mayAbandon(id = 6, current = 7, currentInProgress = true))
        assertTrue(UpdateRules.mayAbandon(id = 6, current = null, currentInProgress = false))
    }

    @Test fun `a tap reuses a live session and only starts a new one when nothing is worth keeping`() {
        fun tap(staging: Boolean = false, alive: Boolean = true, since: Long = 1_000, held: Boolean = false, canShow: Boolean = true) =
            UpdateRules.onTap(staging, alive, since, held, canShow)
        assertEquals(UpdateRules.Tap.WAIT, tap(staging = true, alive = false))
        assertEquals(UpdateRules.Tap.RELAUNCH_CONFIRM, tap(held = true))
        // A held confirm of a live session is better than a new session, stuck or not.
        assertEquals(UpdateRules.Tap.RELAUNCH_CONFIRM, tap(held = true, since = backstop + 1))
        // Play Protect still checking: nothing to show, nothing to restart.
        assertEquals(UpdateRules.Tap.WAIT, tap())
        assertEquals(UpdateRules.Tap.WAIT, tap(held = true, canShow = false))
        assertEquals(UpdateRules.Tap.NEW_SESSION, tap(since = backstop))
        assertEquals(UpdateRules.Tap.NEW_SESSION, tap(alive = false))
        assertEquals(UpdateRules.Tap.NEW_SESSION, tap(alive = false, held = true))
    }

    @Test fun `a session whose confirm screen nobody can show any more is replaced`() {
        assertEquals(UpdateRules.Tap.NEW_SESSION, UpdateRules.onTap(false, alive = true, sinceActivityMs = 1_000, confirmHeld = false, canShowConfirm = true, confirmLost = true))
        // Still staging, or the screen is held after all: as before.
        assertEquals(UpdateRules.Tap.WAIT, UpdateRules.onTap(true, alive = true, sinceActivityMs = 1_000, confirmHeld = false, canShowConfirm = true, confirmLost = true))
        assertEquals(UpdateRules.Tap.RELAUNCH_CONFIRM, UpdateRules.onTap(false, alive = true, sinceActivityMs = 1_000, confirmHeld = true, canShowConfirm = true, confirmLost = true))
    }

    // ── What an answer means ────────────────────────────────────────────

    @Test fun `answers are classified by their INSTALL_FAILED code first, their status only otherwise`() {
        fun c(status: Int, message: String, legacy: Int? = null) = UpdateRules.classify(UpdateRules.Answer(status, message, 1, legacy))
        val table: List<Pair<Triple<Int, String, Int?>, UpdateRules.Outcome>> = listOf(
            // status, message, legacy -> outcome
            Triple(-1, "", null) to UpdateRules.Outcome.NEEDS_USER,
            Triple(0, "INSTALL_SUCCEEDED", null) to UpdateRules.Outcome.INSTALLED,
            // A plain no, or an abort with nothing more to say.
            Triple(3, "INSTALL_FAILED_ABORTED: User rejected permissions", null) to UpdateRules.Outcome.DECLINED,
            Triple(3, "", null) to UpdateRules.Outcome.DECLINED,
            Triple(3, "Session was abandoned", null) to UpdateRules.Outcome.DECLINED,
            // Play Protect: the verifier's codes arrive as ABORTED.
            Triple(3, "INSTALL_FAILED_VERIFICATION_FAILURE", null) to UpdateRules.Outcome.PLAY_PROTECT,
            Triple(3, "INSTALL_FAILED_VERIFICATION_TIMEOUT: Verification timed out", null) to UpdateRules.Outcome.PLAY_PROTECT,
            Triple(3, "", -22) to UpdateRules.Outcome.PLAY_PROTECT,
            Triple(3, "", -21) to UpdateRules.Outcome.PLAY_PROTECT,
            // Xiaomi: USER_RESTRICTED arrives as INCOMPATIBLE.
            Triple(7, "INSTALL_FAILED_USER_RESTRICTED: Install canceled by user", null) to UpdateRules.Outcome.PHONE_BLOCKED,
            Triple(7, "", -111) to UpdateRules.Outcome.PHONE_BLOCKED,
            // Permanent: signature, versionCode, ABI.
            Triple(5, "INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match", null) to UpdateRules.Outcome.PERMANENT,
            Triple(5, "", -7) to UpdateRules.Outcome.PERMANENT,
            Triple(4, "INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES: x", null) to UpdateRules.Outcome.PERMANENT,
            Triple(4, "INSTALL_FAILED_VERSION_DOWNGRADE: older", null) to UpdateRules.Outcome.PERMANENT,
            Triple(7, "INSTALL_FAILED_NO_MATCHING_ABIS: arm64", null) to UpdateRules.Outcome.PERMANENT,
            Triple(7, "", -16) to UpdateRules.Outcome.PERMANENT,
            // A broken file is downloaded again, not refused.
            Triple(4, "INSTALL_FAILED_INVALID_APK: bad zip", null) to UpdateRules.Outcome.BROKEN_FILE,
            Triple(4, "INSTALL_PARSE_FAILED_NOT_APK: x", null) to UpdateRules.Outcome.BROKEN_FILE,
            // Not a real incompatibility: kept, tried again.
            Triple(7, "", null) to UpdateRules.Outcome.FAILED,
            Triple(7, "INSTALL_FAILED_OLDER_SDK: needs 24", null) to UpdateRules.Outcome.FAILED,
            Triple(5, "INSTALL_FAILED_REPLACE_COULDNT_DELETE", null) to UpdateRules.Outcome.FAILED,
            Triple(4, "INSTALL_FAILED_DEXOPT: low storage", null) to UpdateRules.Outcome.FAILED,
            Triple(6, "INSTALL_FAILED_INSUFFICIENT_STORAGE", null) to UpdateRules.Outcome.FAILED,
            Triple(1, "INSTALL_FAILED_INTERNAL_ERROR", null) to UpdateRules.Outcome.FAILED,
            Triple(2, "", null) to UpdateRules.Outcome.FAILED,
            Triple(8, "", null) to UpdateRules.Outcome.FAILED,
        )
        for ((input, expected) in table) {
            val (status, message, legacy) = input
            assertEquals("$status '$message' $legacy", expected, c(status, message, legacy))
        }
    }

    @Test fun `the failure code comes from the message, or else the legacy status`() {
        assertEquals("INSTALL_FAILED_USER_RESTRICTED", UpdateRules.failureCode(UpdateRules.Answer(7, "INSTALL_FAILED_USER_RESTRICTED: Install canceled by user", 1)))
        assertEquals("INSTALL_FAILED_VERIFICATION_FAILURE", UpdateRules.failureCode(UpdateRules.Answer(3, "", 1, -22)))
        assertNull(UpdateRules.failureCode(UpdateRules.Answer(3, "nothing here", 1, -9999)))
    }
}
