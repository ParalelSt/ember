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
    /** Paused or sent to the background this long before an update installs
     *  by itself: a pause to answer a message is not the end of listening. */
    const val IDLE_GRACE_MS = 2 * 60 * 1000L
    const val PACKAGE = "app.ember.music"

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
        /** Music is playing: wait until it stops. */
        WAIT_PLAYING,
        /** Stopped, but only just: wait out [IDLE_GRACE_MS]. */
        WAIT_IDLE,
        /** Show "Update ready, tap to install": Android will ask anyway, or
         *  the app is open in front of the person and should not vanish. */
        ASK_USER,
        /** "Install unknown apps" is off for Ember: the page offers the
         *  Settings switch. */
        NEED_PERMISSION,
    }

    data class InstallFacts(
        /** The phone's player (or the TV it casts to) is playing. */
        val playing: Boolean,
        /** Android Auto is projecting, or a car is connected to the player. */
        val carSession: Boolean,
        /** Ember's window is on screen. */
        val foreground: Boolean,
        /** Since the music stopped or the app left the screen, whichever was
         *  later. */
        val idleMs: Long,
        /** The person tapped Install. */
        val userRequested: Boolean,
        val silentLikely: Boolean,
        /** "Install unknown apps" is allowed for Ember. */
        val canInstall: Boolean,
    )

    /** When a downloaded update may install. Installing replaces the running
     *  app, which stops the player service, so:
     *  - never during a car session, not even on a tap: the car loses its
     *    music, and the driver should not be looking at a dialog;
     *  - never on its own while music plays (a tap is the person's choice);
     *  - on its own only when Android will not ask, the app is not on
     *    screen, and nothing has played for [IDLE_GRACE_MS]. */
    fun decide(f: InstallFacts): Decision = when {
        f.carSession -> Decision.WAIT_CAR
        !f.canInstall -> Decision.NEED_PERMISSION
        f.userRequested -> Decision.INSTALL
        f.playing -> Decision.WAIT_PLAYING
        !f.silentLikely || f.foreground -> Decision.ASK_USER
        f.idleMs < IDLE_GRACE_MS -> Decision.WAIT_IDLE
        else -> Decision.INSTALL
    }

    /** Whether the player counts as playing for the updater: it is meant to
     *  play (playWhenReady) and has something loaded that has not ended.
     *  States: 1 idle, 2 buffering, 3 ready, 4 ended (Player.STATE_*). */
    fun meansPlaying(playWhenReady: Boolean, playbackState: Int): Boolean =
        playWhenReady && playbackState != 1 && playbackState != 4

    /** Whether a periodic or start-up check is due. */
    fun checkDue(now: Long, lastCheck: Long, minGapMs: Long): Boolean =
        lastCheck <= 0 || now < lastCheck || now - lastCheck >= minGapMs

    /** The line the car's Home shows while an update waits, or null. Only
     *  for a downloaded, verified update: nothing to read about a check.
     *  Where Android will ask before installing ([silent] false), the
     *  person finishes it on the phone once parked. */
    fun carNotice(ready: Boolean, silent: Boolean = true): Pair<String, String>? = when {
        !ready -> null
        silent -> "Ember update ready" to "Installs when you're parked and the music is stopped"
        else -> "Ember update ready" to "Once you're parked, open Ember on your phone to install"
    }
}
