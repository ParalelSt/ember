package app.ember.music

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import java.security.MessageDigest

/** Who may connect to [EmberPlaybackService] (security audit 2026-09-25, M4).
 *
 *  The service is exported because Android Auto, the car's media centre, the
 *  system media controls and the Assistant bind to it from their own
 *  processes. Exported also means any app on the phone could bind, then
 *  browse the member's playlists, likes and history, run searches, and drive
 *  playback. So a controller is let in only when it is one of:
 *
 *  - Ember itself (same uid), or the system (uid 1000);
 *  - signed with the platform key, like the "android" package: SystemUI's
 *    media controls, Bluetooth, the car's media centre on Android Automotive;
 *  - a known Google app signed with Google's key: Android Auto, the Google
 *    app / Assistant, Assistant on Automotive, Wear OS (the keys are UAMP's
 *    allowed_media_browser_callers.xml; debug keys only in a debuggable build);
 *  - one of those same known packages preinstalled on the system image,
 *    which an installed app cannot impersonate (covers an OEM-signed car
 *    media centre, or a key rotated after this list was written);
 *  - trusted by Android for media control (Media3's `ControllerInfo.isTrusted`:
 *    it holds MEDIA_CONTENT_CONTROL, or is a notification listener the user
 *    enabled, which can already control every media session anyway);
 *  - on Android 8.1 and older, an unidentifiable legacy controller: the
 *    platform does not say who sent a transport command there, so refusing
 *    it would break lock-screen and headset controls. Browsing is never
 *    unidentified (a MediaBrowser always names its package).
 *
 *  Everything else is refused. The same shape as UAMP's PackageValidator. */
object ControllerPolicy {
    const val SYSTEM_UID = 1000

    /** What Media3 calls a platform controller it cannot identify. */
    const val LEGACY_CONTROLLER = "android.media.session.MediaController"

    class KnownApp(val name: String, val releaseKeys: Set<String>, val debugKeys: Set<String> = emptySet())

    /** SHA-256 of the signing certificate, lower case with colons. */
    val KNOWN_APPS: Map<String, KnownApp> = mapOf(
        "com.google.android.projection.gearhead" to KnownApp(
            "Android Auto",
            releaseKeys = setOf(
                "fd:b0:0c:43:db:de:8b:51:cb:31:2a:a8:1d:3b:5f:a1:77:13:ad:b9:4b:28:f5:98:d7:7f:8e:b8:9d:ac:ee:df",
                // rotated prod key
                "1c:a8:dc:c0:be:d3:cb:d8:72:d2:cb:79:12:00:c0:29:2c:a9:97:57:68:a8:2d:67:6b:8b:42:4f:b6:5b:52:95",
            ),
            debugKeys = setOf(
                "19:75:b2:f1:71:77:bc:89:a5:df:f3:1f:9e:64:a6:ca:e2:81:a5:3d:c1:d1:d5:9b:1d:14:7f:e1:c8:2a:fa:00",
                "70:81:1a:3e:ac:fd:2e:83:e1:8d:a9:bf:ed:e5:2d:f1:6c:e9:1f:2e:69:a4:4d:21:f1:8a:b6:69:91:13:07:71",
            ),
        ),
        "com.google.android.googlequicksearchbox" to KnownApp(
            "Google / Assistant",
            releaseKeys = setOf("f0:fd:6c:5b:41:0f:25:cb:25:c3:b5:33:46:c8:97:2f:ae:30:f8:ee:74:11:df:91:04:80:ad:6b:2d:60:db:83"),
            debugKeys = setOf("19:75:b2:f1:71:77:bc:89:a5:df:f3:1f:9e:64:a6:ca:e2:81:a5:3d:c1:d1:d5:9b:1d:14:7f:e1:c8:2a:fa:00"),
        ),
        "com.google.android.carassistant" to KnownApp(
            "Assistant on Android Automotive",
            releaseKeys = setOf("74:b6:fb:f7:10:e8:d9:0d:44:d3:40:12:58:89:b4:23:06:a6:2c:43:79:d0:e5:a6:62:20:e3:a6:8a:bf:90:e2"),
            debugKeys = setOf("17:e2:81:11:06:2f:97:a8:60:79:7a:83:70:5b:f8:2c:7c:c0:29:35:56:6d:46:22:bc:4e:cf:ee:1b:eb:f8:15"),
        ),
        "com.google.android.wearable.app" to KnownApp(
            "Wear OS",
            releaseKeys = setOf("85:cd:59:73:54:1b:e6:f4:77:d8:47:a0:bc:c6:aa:25:27:68:4b:81:9c:d5:96:85:29:66:4c:b0:71:57:b6:fe"),
            debugKeys = setOf("69:d0:72:16:9a:2c:6b:2f:5a:cc:59:0c:e4:33:a1:1a:c3:df:55:1a:df:ee:5d:5f:63:c0:83:b7:22:76:2e:19"),
        ),
        "com.google.android.autosimulator" to KnownApp(
            "Android Auto Simulator",
            releaseKeys = setOf("19:75:b2:f1:71:77:bc:89:a5:df:f3:1f:9e:64:a6:ca:e2:81:a5:3d:c1:d1:d5:9b:1d:14:7f:e1:c8:2a:fa:00"),
        ),
    )

    /** Known media controllers trusted by package name when they are part of
     *  the system image (a preinstalled package cannot be replaced by an app
     *  signed with another key). */
    val SYSTEM_MEDIA_PACKAGES: Set<String> = KNOWN_APPS.keys + setOf(
        "com.android.systemui",
        "com.android.bluetooth",
        "com.google.android.bluetooth",
        "com.android.car.media",
        "com.android.car.carlauncher",
    )

    /** What the service knows about a caller. */
    data class Caller(
        val packageName: String,
        val uid: Int,
        /** The uid the package manager has for [packageName]; null when the
         *  package is unknown to it. */
        val packageUid: Int?,
        /** SHA-256 of every certificate in the signing lineage (a rotated
         *  key lists the old and the new); empty when unknown or when the APK
         *  has more than one signer. */
        val certs: Set<String>,
        /** Preinstalled on the system image (FLAG_SYSTEM or an update of one). */
        val isSystemApp: Boolean,
        /** Media3's ControllerInfo.isTrusted. */
        val trustedForMediaControl: Boolean,
    )

    enum class Verdict(val allowed: Boolean) {
        OWN_APP(true),
        SYSTEM(true),
        PLATFORM_SIGNED(true),
        KNOWN_APP(true),
        SYSTEM_MEDIA_APP(true),
        TRUSTED_FOR_MEDIA(true),
        LEGACY_UNIDENTIFIED(true),
        UID_MISMATCH(false),
        UNKNOWN(false),
    }

    fun decide(
        caller: Caller,
        ownUid: Int,
        platformCerts: Set<String>,
        debuggable: Boolean,
        sdkInt: Int,
    ): Verdict {
        if (caller.uid == ownUid) return Verdict.OWN_APP
        if (caller.uid == SYSTEM_UID) return Verdict.SYSTEM
        if (caller.packageName == LEGACY_CONTROLLER) {
            return if (sdkInt < 28) Verdict.LEGACY_UNIDENTIFIED else Verdict.UNKNOWN
        }
        // The name must be the caller's own: a package name the package
        // manager does not know, or knows under another uid, is refused.
        if (caller.packageUid == null || caller.packageUid != caller.uid) return Verdict.UID_MISMATCH
        if (caller.certs.isNotEmpty() && caller.certs.any { it in platformCerts }) return Verdict.PLATFORM_SIGNED
        val known = KNOWN_APPS[caller.packageName]
        if (known != null) {
            val keys = if (debuggable) known.releaseKeys + known.debugKeys else known.releaseKeys
            if (caller.certs.any { it in keys }) return Verdict.KNOWN_APP
        }
        if (caller.isSystemApp && caller.packageName in SYSTEM_MEDIA_PACKAGES) return Verdict.SYSTEM_MEDIA_APP
        if (caller.trustedForMediaControl) return Verdict.TRUSTED_FOR_MEDIA
        return Verdict.UNKNOWN
    }

    fun sha256(cert: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(cert).joinToString(":") { "%02x".format(it) }
}

/** Reads a caller's facts from the package manager, once per package and uid
 *  (a package's uid and signature cannot change without a reinstall, which
 *  gives it a new uid pairing anyway). */
class ControllerGate(private val context: Context) {
    private val pm: PackageManager = context.packageManager
    private val cache = HashMap<Pair<String, Int>, ControllerPolicy.Verdict>()
    private val platformCerts: Set<String> by lazy { certsOf(packageInfo("android")) }
    private val debuggable: Boolean
        get() = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    @Synchronized
    fun verdict(packageName: String, uid: Int, trustedForMediaControl: Boolean): ControllerPolicy.Verdict =
        cache.getOrPut(packageName to uid) {
            ControllerPolicy.decide(facts(packageName, uid, trustedForMediaControl), Process.myUid(), platformCerts, debuggable, Build.VERSION.SDK_INT)
        }

    private fun facts(packageName: String, uid: Int, trusted: Boolean): ControllerPolicy.Caller {
        val info = packageInfo(packageName)
        val app = info?.applicationInfo
        val system = app != null && app.flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
        return ControllerPolicy.Caller(packageName, uid, app?.uid, certsOf(info), system, trusted)
    }

    @SuppressLint("PackageManagerGetSignatures")
    @Suppress("DEPRECATION")
    private fun packageInfo(packageName: String): PackageInfo? = runCatching {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        pm.getPackageInfo(packageName, flags)
    }.getOrNull()

    @Suppress("DEPRECATION")
    private fun certsOf(info: PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val sigs = if (Build.VERSION.SDK_INT >= 28) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
        } else {
            info.signatures
        } ?: return emptySet()
        // More than one signer at once (not a rotation lineage) is refused,
        // as UAMP does: which of them would be the app's identity?
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo?.hasMultipleSigners() == true && sigs.size != 1) return emptySet()
        if (Build.VERSION.SDK_INT < 28 && sigs.size != 1) return emptySet()
        return sigs.map { ControllerPolicy.sha256(it.toByteArray()) }.toSet()
    }
}
