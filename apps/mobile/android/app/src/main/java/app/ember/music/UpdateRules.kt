package app.ember.music

import org.json.JSONObject

/** Every decision the in-app updater (AppUpdater) makes, as plain functions
 *  of plain facts, so each one is tested without a phone: is the release
 *  newer, may it download on this network, is the downloaded APK really the
 *  next Ember, and may it install right now. */
object UpdateRules {
    /** Checked on app start (at most this often) and every [PERIOD_MS] by
     *  UpdateCheckJob. */
    const val PERIOD_MS = 6 * 60 * 60 * 1000L
    /** A page reload restarts the plugin; that is not a new app start. */
    const val START_CHECK_MIN_MS = 15 * 60 * 1000L
    const val PACKAGE = "app.ember.music"

    /** The separate "Ember Test" app (applicationIdSuffix ".test"). */
    fun isTestBuild(packageName: String?): Boolean = packageName?.endsWith(".test") == true

    /** Whether a check nobody asked for (the 6-hourly job, the app-start
     *  check) may run. The test build never updates in the background: a
     *  release APK is another package, so it could never install anyway.
     *  A person's own tap (manual) and the launch gate always may. */
    fun backgroundCheckAllowed(packageName: String?, manual: Boolean): Boolean =
        manual || !isTestBuild(packageName)

    /** A non-manual check does not download a version that was already
     *  refused for good; a newer version is a different string. */
    fun skipRejected(rejectedVersion: String?, offered: String, manual: Boolean): Boolean =
        !manual && rejectedVersion != null && rejectedVersion == offered

    // ── Versions ────────────────────────────────────────────────────────

    /** "0.4.18" or "v0.4.18" to [0, 4, 18]; null when it is not x.y.z. */
    fun parseVersion(v: String?): List<Int>? {
        val m = Regex("""^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$""").find(v?.trim() ?: return null) ?: return null
        return m.groupValues.drop(1).map { it.toInt() }
    }

    /** Whether [candidate] is a later x.y.z than [current], compared number by
     *  number (0.4.10 is after 0.4.9). Anything unparseable is never newer. */
    fun isNewer(candidate: String?, current: String?): Boolean {
        val a = parseVersion(candidate) ?: return false
        val b = parseVersion(current) ?: return true
        for (i in 0 until 3) {
            if (a[i] != b[i]) return a[i] > b[i]
        }
        return false
    }

    /** What the server's feed offered (GET /api/android/update). */
    data class Feed(
        val version: String,
        val versionCode: Long?,
        /** A path on the Ember server, or a full URL. */
        val url: String,
        val size: Long,
        val sha256: String?,
    )

    /** The feed's 200 body, or null when it is not a usable offer. */
    fun parseFeed(json: JSONObject?): Feed? {
        json ?: return null
        val version = json.optString("version").trim()
        val url = json.optString("url").trim()
        if (parseVersion(version) == null || url.isEmpty()) return null
        val code = if (json.has("versionCode") && !json.isNull("versionCode")) json.optLong("versionCode", -1).takeIf { it > 0 } else null
        val sha = json.optString("sha256").lowercase().takeIf { !json.isNull("sha256") && Regex("^[0-9a-f]{64}$").matches(it) }
        return Feed(version, code, url, json.optLong("size", -1), sha)
    }

    /** Whether the offer is worth downloading for an app on
     *  ([currentName], [currentCode]). The versionCode settles it when the
     *  feed knows one; otherwise the version name does, and the APK's own
     *  versionCode is checked again after the download (verify). */
    fun offerIsNewer(feed: Feed, currentName: String?, currentCode: Long): Boolean {
        if (feed.versionCode != null && feed.versionCode <= currentCode) return false
        return isNewer(feed.version, currentName)
    }

    // ── Network ─────────────────────────────────────────────────────────

    /** The active network as ConnectivityManager reports it. */
    data class NetFacts(
        val internet: Boolean,
        val validated: Boolean,
        val wifi: Boolean,
        val cellular: Boolean,
        val ethernet: Boolean,
    )

    /** Download only over a network that really reaches the internet
     *  (INTERNET and VALIDATED: a captive portal does not count), on Wi-Fi,
     *  mobile data or ethernet. Mobile data is allowed on purpose: the owner
     *  wants updates to land without waiting for Wi-Fi. No network at all,
     *  or some other transport (a VPN alone, Bluetooth tethering), waits. */
    fun canDownload(net: NetFacts?): Boolean {
        net ?: return false
        if (!net.internet || !net.validated) return false
        return net.wifi || net.cellular || net.ethernet
    }

    // ── The downloaded APK ──────────────────────────────────────────────

    enum class Verdict { OK, UNREADABLE, WRONG_PACKAGE, NOT_NEWER, SIGNATURE_MISMATCH, HASH_MISMATCH }

    /** What the APK says about itself (PackageManager.getPackageArchiveInfo)
     *  and what the installed app says. Signers are SHA-256 digests of the
     *  certificates, in hex. */
    data class Archive(
        val packageName: String?,
        val versionCode: Long,
        /** The certificates the APK is signed with now. */
        val signers: Set<String>,
        /** Every certificate in its signing lineage (key rotation), current
         *  included; empty when the APK has no lineage. */
        val history: Set<String> = emptySet(),
    )

    data class Installed(val versionCode: Long, val signers: Set<String>)

    /** Signed by the same key as the installed app. A rotated key passes
     *  when the installed app's (single) key is in the APK's lineage, which
     *  is the only rotation Android itself accepts as an update. No
     *  certificates on either side is never a match. */
    fun signaturesMatch(installed: Set<String>, archive: Set<String>, archiveHistory: Set<String> = emptySet()): Boolean {
        if (installed.isEmpty() || archive.isEmpty()) return false
        if (installed == archive) return true
        return installed.size == 1 && archive.size == 1 && archiveHistory.containsAll(installed)
    }

    /** The APK is installed only when it is Ember, newer than what runs,
     *  signed with the same key, and (when the feed gave one) the file the
     *  release published. Android would refuse a different key itself; this
     *  says why before a dialog appears and fails. */
    fun verify(
        archive: Archive?,
        installed: Installed,
        expectedSha256: String? = null,
        actualSha256: String? = null,
        packageName: String = PACKAGE,
    ): Verdict {
        if (expectedSha256 != null && !expectedSha256.equals(actualSha256, ignoreCase = true)) return Verdict.HASH_MISMATCH
        archive ?: return Verdict.UNREADABLE
        if (archive.packageName != packageName) return Verdict.WRONG_PACKAGE
        if (archive.versionCode <= installed.versionCode) return Verdict.NOT_NEWER
        if (!signaturesMatch(installed.signers, archive.signers, archive.history)) return Verdict.SIGNATURE_MISMATCH
        return Verdict.OK
    }

    /** A refusal that will not change on a second download: remembered, so
     *  the 6-hourly check does not fetch the same APK again. A hash
     *  mismatch or an unreadable file can be a damaged transfer, so those
     *  are tried again. */
    fun isPermanent(v: Verdict): Boolean =
        v == Verdict.WRONG_PACKAGE || v == Verdict.NOT_NEWER || v == Verdict.SIGNATURE_MISMATCH

    // ── Installing ──────────────────────────────────────────────────────

    /** Whether Android will install without asking: Android 12+ with
     *  setRequireUserAction(USER_ACTION_NOT_REQUIRED), and only when Ember
     *  itself is the installer of record. An APK the person installed from a
     *  browser or file manager has that app as its installer, so the first
     *  update from inside Ember asks once; after it Ember is the installer
     *  and later updates are silent. */
    fun silentLikely(sdk: Int, installerOfRecord: String?, self: String = PACKAGE): Boolean =
        sdk >= 31 && installerOfRecord == self

    enum class Decision {
        /** Install now. */
        INSTALL,
        /** In the car (Android Auto): wait until the car has gone. */
        WAIT_CAR,
        /** Show "Update ready, tap to install": an install starts only from
         *  the person's tap, never by itself. */
        ASK_USER,
        /** "Install unknown apps" is off for Ember: the page offers the
         *  Settings switch. */
        NEED_PERMISSION,
    }

    data class InstallFacts(
        /** Android Auto is projecting, or a car is connected to the player. */
        val carSession: Boolean,
        /** The person tapped Install (or the launch gate's Update now). */
        val userRequested: Boolean,
        /** "Install unknown apps" is allowed for Ember. */
        val canInstall: Boolean,
    )

    /** When a downloaded update may install. Installing replaces the running
     *  app, which stops the player service, so:
     *  - never during a car session, not even on a tap: the car loses its
     *    music, and the driver should not be looking at a dialog;
     *  - never without a tap: Play Protect's scan prompt appears right
     *    after an install starts, so it must only follow the person's own
     *    action. A tap installs even while music plays (the person's
     *    choice). */
    fun decide(f: InstallFacts): Decision = when {
        f.carSession -> Decision.WAIT_CAR
        !f.canInstall -> Decision.NEED_PERMISSION
        f.userRequested -> Decision.INSTALL
        else -> Decision.ASK_USER
    }

    /** Whether the player counts as playing for the updater: it is meant to
     *  play (playWhenReady) and has something loaded that has not ended.
     *  States: 1 idle, 2 buffering, 3 ready, 4 ended (Player.STATE_*). */
    fun meansPlaying(playWhenReady: Boolean, playbackState: Int): Boolean =
        playWhenReady && playbackState != 1 && playbackState != 4

    /** Android never reopens an app that updated itself. Before Android 10
     *  the new version may open its own window from MY_PACKAGE_REPLACED
     *  (UpdatedReceiver); from 10 on Android blocks activity starts from the
     *  background, so it can only post "Ember updated, tap to open". */
    fun relaunchDirectly(sdk: Int): Boolean = sdk < 29

    /** Whether to ask for POST_NOTIFICATIONS right before an install the
     *  person waits on: from Android 13 that notice is the only way back into
     *  Ember, and without the permission it is dropped silently. Android
     *  itself stops showing the dialog once it has been refused twice. */
    fun askNotificationsFirst(sdk: Int, granted: Boolean): Boolean = sdk >= 33 && !granted

    /** Whether a periodic or start-up check is due. */
    fun checkDue(now: Long, lastCheck: Long, minGapMs: Long): Boolean =
        lastCheck <= 0 || now < lastCheck || now - lastCheck >= minGapMs

    /** The line the car's Library shows while an update waits, or null. Only
     *  for a downloaded, verified update: nothing to read about a check.
     *  An install starts only from a tap, so the person finishes it on the
     *  phone once parked. */
    fun carNotice(ready: Boolean): Pair<String, String>? =
        if (ready) "Ember update ready" to "Once you're parked, open Ember on your phone to install" else null

    // ── Android's answers ───────────────────────────────────────────────

    /** One answer from the install session (UpdateInstallReceiver):
     *  PackageInstaller's EXTRA_STATUS, EXTRA_STATUS_MESSAGE (on most
     *  versions "INSTALL_FAILED_<CODE>: why"), EXTRA_SESSION_ID (-1 when
     *  missing) and the internal INSTALL_FAILED_* code Android also sends
     *  (EXTRA_LEGACY_STATUS), when it does. */
    data class Answer(val status: Int, val message: String, val sessionId: Int, val legacy: Int? = null)

    /** An install session that showed no sign of life (committed, a confirm
     *  screen asked for or opened, an answer) for this long counts as stuck.
     *  Long on purpose: Android's confirm, a vendor's security scan and Play
     *  Protect's "Install anyway" can each take minutes. */
    const val INSTALL_BACKSTOP_MS = 10 * 60 * 1000L

    /** Whether the session Ember committed is still worth waiting for:
     *  Android still has it ([alive]) and it showed a sign of life within
     *  [INSTALL_BACKSTOP_MS]. A clock that went back counts as recent. */
    fun sessionInProgress(alive: Boolean, sinceActivityMs: Long): Boolean =
        alive && sinceActivityMs < INSTALL_BACKSTOP_MS

    /** Whether a new install may abandon Ember's session [id]: any session
     *  but the committed one ([current]) while it is in progress. A
     *  session nobody committed is a leftover (staging died), and a stuck
     *  one would block the update for good. */
    fun mayAbandon(id: Int, current: Int?, currentInProgress: Boolean): Boolean =
        !(id == current && currentInProgress)

    enum class Tap {
        /** Show the held confirm screen of the live session again. */
        RELAUNCH_CONFIRM,
        /** The session is still being staged, confirmed or verified (Play
         *  Protect): stay on "installing" and let it finish. */
        WAIT,
        /** Nothing worth keeping: stage a new session. */
        NEW_SESSION,
    }

    /** What a tap on Install (or the gate's Update now) does while Ember may
     *  already have a session. Reusing the live one is always better than a
     *  new one: abandoning a session in Play Protect's check ends that
     *  install, and its late answer used to end the new one too. */
    fun onTap(staging: Boolean, alive: Boolean, sinceActivityMs: Long, confirmHeld: Boolean, canShowConfirm: Boolean): Tap = when {
        staging -> Tap.WAIT
        alive && confirmHeld && canShowConfirm -> Tap.RELAUNCH_CONFIRM
        sessionInProgress(alive, sinceActivityMs) -> Tap.WAIT
        else -> Tap.NEW_SESSION
    }

    /** Whether an answer is for the session this install committed. One
     *  for another session (an earlier attempt that was abandoned, answering
     *  late) must not end this one; no known session, or an answer without
     *  an id, is never a match. */
    fun isCurrentSession(current: Int?, incoming: Int): Boolean =
        current != null && incoming >= 0 && incoming == current

    fun statusName(status: Int): String = when (status) {
        android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION -> "pending-user-action"
        android.content.pm.PackageInstaller.STATUS_SUCCESS -> "success"
        android.content.pm.PackageInstaller.STATUS_FAILURE -> "failure"
        android.content.pm.PackageInstaller.STATUS_FAILURE_BLOCKED -> "blocked"
        android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED -> "aborted"
        android.content.pm.PackageInstaller.STATUS_FAILURE_INVALID -> "invalid"
        android.content.pm.PackageInstaller.STATUS_FAILURE_CONFLICT -> "conflict"
        android.content.pm.PackageInstaller.STATUS_FAILURE_STORAGE -> "storage"
        android.content.pm.PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatible"
        8 -> "timeout" // STATUS_FAILURE_TIMEOUT, Android 14
        else -> "status $status"
    }

    /** "aborted (3): INSTALL_FAILED_VERIFICATION_FAILURE", for the log. */
    fun describeStatus(status: Int, message: String?): String {
        val m = message?.trim().orEmpty()
        val base = "${statusName(status)} ($status)"
        return if (m.isEmpty()) base else "$base: $m"
    }

    /** ABORTED because the person said no on Android's confirm screen ("User
     *  rejected permissions"), as opposed to Play Protect or a verifier
     *  stopping it, which also arrive as ABORTED. Only a plain cancel stays
     *  out of the daily digest. */
    fun isPlainCancel(status: Int, message: String?): Boolean {
        if (status != android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED) return false
        val m = message?.trim().orEmpty()
        if (m.contains("VERIFICATION", ignoreCase = true)) return false
        return m.isEmpty() || m.contains("rejected", ignoreCase = true) || m.equals("INSTALL_FAILED_ABORTED", ignoreCase = true)
    }

    /** How often the updater looks at its session while installing. */
    const val INSTALL_WATCH_MS = 15_000L
    /** A session gone with no answer is given this long for the answer to
     *  arrive (it is on its way, or the process is about to be replaced by
     *  the new version) before the install counts as ended. */
    const val SESSION_GONE_GRACE_MS = 5_000L

    /** What an answer means for the waiting APK. */
    enum class Outcome {
        /** Android's confirm screen is needed. */
        NEEDS_USER,
        INSTALLED,
        /** The person said no (or an abort with no other reason): keep the
         *  APK, no error. */
        DECLINED,
        /** Play Protect (the package verifier) blocked it or ran out of
         *  time: keep the APK and say how to get past it. */
        PLAY_PROTECT,
        /** The phone's own security check refused or was cancelled
         *  (INSTALL_FAILED_USER_RESTRICTED, typical of Xiaomi's installer):
         *  keep the APK, try again on a tap. */
        PHONE_BLOCKED,
        /** Can never go in: another signing key, not newer, or no ABI the
         *  phone runs. The version is refused and the APK dropped. */
        PERMANENT,
        /** The APK itself could not be read: dropped so the next check
         *  downloads it again, but the version is not refused. */
        BROKEN_FILE,
        /** Anything else (storage, a passing conflict): keep the APK. */
        FAILED,
    }

    /** INSTALL_FAILED_* codes (Android's legacy status) by name. */
    private val LEGACY_NAMES = mapOf(
        -2 to "INSTALL_FAILED_INVALID_APK",
        -7 to "INSTALL_FAILED_UPDATE_INCOMPATIBLE",
        -16 to "INSTALL_FAILED_CPU_ABI_INCOMPATIBLE",
        -21 to "INSTALL_FAILED_VERIFICATION_TIMEOUT",
        -22 to "INSTALL_FAILED_VERIFICATION_FAILURE",
        -25 to "INSTALL_FAILED_VERSION_DOWNGRADE",
        -100 to "INSTALL_PARSE_FAILED_NOT_APK",
        -103 to "INSTALL_PARSE_FAILED_NO_CERTIFICATES",
        -104 to "INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES",
        -111 to "INSTALL_FAILED_USER_RESTRICTED",
        -113 to "INSTALL_FAILED_NO_MATCHING_ABIS",
        -115 to "INSTALL_FAILED_ABORTED",
    )

    /** Only a signature, versionCode or ABI mismatch is permanent. */
    private val PERMANENT_CODES = setOf(
        "INSTALL_FAILED_UPDATE_INCOMPATIBLE",
        "INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES",
        "INSTALL_FAILED_VERSION_DOWNGRADE",
        "INSTALL_FAILED_NO_MATCHING_ABIS",
        "INSTALL_FAILED_CPU_ABI_INCOMPATIBLE",
    )

    private val CODE = Regex("INSTALL_(?:PARSE_)?FAILED_[A-Z_]+")

    /** The INSTALL_FAILED_* behind an answer: from its message ("CODE: why")
     *  or, failing that, its legacy status; null when neither says. */
    fun failureCode(a: Answer): String? = CODE.find(a.message)?.value ?: a.legacy?.let { LEGACY_NAMES[it] }

    /** What [a] means. Android folds many causes into a few public statuses
     *  (Play Protect's block comes as ABORTED, Xiaomi's USER_RESTRICTED as
     *  INCOMPATIBLE), so the INSTALL_FAILED_* code decides where there is
     *  one, and the status only otherwise. */
    fun classify(a: Answer): Outcome {
        when (a.status) {
            android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION -> return Outcome.NEEDS_USER
            android.content.pm.PackageInstaller.STATUS_SUCCESS -> return Outcome.INSTALLED
        }
        val code = failureCode(a)
        return when {
            code == "INSTALL_FAILED_VERIFICATION_FAILURE" || code == "INSTALL_FAILED_VERIFICATION_TIMEOUT" -> Outcome.PLAY_PROTECT
            code == "INSTALL_FAILED_USER_RESTRICTED" -> Outcome.PHONE_BLOCKED
            code in PERMANENT_CODES -> Outcome.PERMANENT
            code == "INSTALL_FAILED_INVALID_APK" || code?.startsWith("INSTALL_PARSE_FAILED_") == true -> Outcome.BROKEN_FILE
            a.status == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED -> Outcome.DECLINED
            else -> Outcome.FAILED
        }
    }

    /** Whether an install with no answer from Android ends now, back to
     *  "tap to install". Not while the APK is still being staged, and not
     *  while Android still has the session: its confirm screen, a vendor's
     *  security scan and Play Protect's "Install anyway" all keep it, however
     *  long they take, and leaving one of those screens is not an answer.
     *  Only a session gone for [SESSION_GONE_GRACE_MS] with no answer, or no
     *  sign of life for [INSTALL_BACKSTOP_MS], ends it. The launch gate, the
     *  pill and Settings follow the same rule. */
    fun unstickNow(staging: Boolean, sessionAlive: Boolean, sinceActivityMs: Long, goneForMs: Long): Boolean = when {
        sinceActivityMs >= INSTALL_BACKSTOP_MS -> true
        staging || sessionAlive -> false
        else -> goneForMs >= SESSION_GONE_GRACE_MS
    }
}
