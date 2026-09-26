package app.ember.music

import app.ember.music.ControllerPolicy.Caller
import app.ember.music.ControllerPolicy.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Who may connect to the exported playback service (security audit
 *  2026-09-25, M4): the pure decision, no Android needed. */
class ControllerPolicyTest {
    private val own = 10_100
    private val platform = setOf("aa:aa")
    private val strangerKey = "de:ad:be:ef"
    private val autoKey = ControllerPolicy.KNOWN_APPS.getValue("com.google.android.projection.gearhead").releaseKeys.first()
    private val autoRotated = ControllerPolicy.KNOWN_APPS.getValue("com.google.android.projection.gearhead").releaseKeys.last()
    private val autoDebug = ControllerPolicy.KNOWN_APPS.getValue("com.google.android.projection.gearhead").debugKeys.last()
    private val gsaKey = ControllerPolicy.KNOWN_APPS.getValue("com.google.android.googlequicksearchbox").releaseKeys.first()

    private fun caller(
        pkg: String,
        uid: Int = 10_555,
        packageUid: Int? = uid,
        certs: Set<String> = setOf(strangerKey),
        system: Boolean = false,
        trusted: Boolean = false,
    ) = Caller(pkg, uid, packageUid, certs, system, trusted)

    private fun decide(c: Caller, debuggable: Boolean = false, sdk: Int = 34) =
        ControllerPolicy.decide(c, own, platform, debuggable, sdk)

    @Test fun `an ordinary app on the phone is refused`() {
        val v = decide(caller("com.example.spyware"))
        assertEquals(Verdict.UNKNOWN, v)
        assertFalse(v.allowed)
    }

    @Test fun `an app that calls itself Android Auto but is signed by someone else is refused`() {
        assertFalse(decide(caller("com.google.android.projection.gearhead")).allowed)
        assertFalse(decide(caller("com.google.android.googlequicksearchbox"), debuggable = true).allowed)
    }

    @Test fun `a package name that is not the caller's own is refused`() {
        // The package manager knows gearhead under another uid than the caller's.
        assertEquals(Verdict.UID_MISMATCH, decide(caller("com.google.android.projection.gearhead", uid = 10_555, packageUid = 10_200, certs = setOf(autoKey))))
        // Or does not know the package at all.
        assertEquals(Verdict.UID_MISMATCH, decide(caller("com.nowhere", packageUid = null)))
    }

    @Test fun `Ember itself and the system are let in`() {
        assertEquals(Verdict.OWN_APP, decide(caller("app.ember.music", uid = own, packageUid = own)))
        assertEquals(Verdict.SYSTEM, decide(caller("android", uid = ControllerPolicy.SYSTEM_UID)))
    }

    @Test fun `Android Auto with Google's key is let in, the rotated key too`() {
        assertEquals(Verdict.KNOWN_APP, decide(caller("com.google.android.projection.gearhead", certs = setOf(autoKey))))
        assertEquals(Verdict.KNOWN_APP, decide(caller("com.google.android.projection.gearhead", certs = setOf(autoKey, autoRotated))))
        assertEquals(Verdict.KNOWN_APP, decide(caller("com.google.android.projection.gearhead", certs = setOf(autoRotated))))
    }

    @Test fun `Android Auto's debug key counts only in a debuggable Ember build`() {
        assertFalse(decide(caller("com.google.android.projection.gearhead", certs = setOf(autoDebug)), debuggable = false).allowed)
        assertEquals(Verdict.KNOWN_APP, decide(caller("com.google.android.projection.gearhead", certs = setOf(autoDebug)), debuggable = true))
    }

    @Test fun `a known key only counts for its own package`() {
        assertFalse(decide(caller("com.example.spyware", certs = setOf(autoKey))).allowed)
    }

    @Test fun `the Google app (Hey Google) is let in`() {
        assertEquals(Verdict.KNOWN_APP, decide(caller("com.google.android.googlequicksearchbox", certs = setOf(gsaKey))))
    }

    @Test fun `anything signed with the platform key is let in (SystemUI, Bluetooth, the car's media centre)`() {
        assertEquals(Verdict.PLATFORM_SIGNED, decide(caller("com.android.systemui", certs = platform)))
        assertEquals(Verdict.PLATFORM_SIGNED, decide(caller("com.android.car.media", certs = platform)))
    }

    @Test fun `a preinstalled media controller is let in whatever its key, a preinstalled other app is not`() {
        assertEquals(Verdict.SYSTEM_MEDIA_APP, decide(caller("com.android.car.media", system = true)))
        assertEquals(Verdict.SYSTEM_MEDIA_APP, decide(caller("com.google.android.bluetooth", system = true)))
        assertEquals(Verdict.SYSTEM_MEDIA_APP, decide(caller("com.google.android.projection.gearhead", system = true)))
        assertFalse(decide(caller("com.oem.weather", system = true)).allowed)
        // The same package name sideloaded is not preinstalled.
        assertFalse(decide(caller("com.android.car.media", system = false)).allowed)
    }

    @Test fun `a controller Android trusts for media control is let in`() {
        assertEquals(Verdict.TRUSTED_FOR_MEDIA, decide(caller("com.example.watchcompanion", trusted = true)))
    }

    @Test fun `an unidentifiable legacy controller only on Android 8_1 and older`() {
        val legacy = caller(ControllerPolicy.LEGACY_CONTROLLER, uid = -1, packageUid = null, certs = emptySet())
        assertEquals(Verdict.LEGACY_UNIDENTIFIED, decide(legacy, sdk = 27))
        assertFalse(decide(legacy, sdk = 28).allowed)
    }

    @Test fun `a caller with no readable certificate is not platform signed`() {
        assertFalse(decide(caller("com.example.nosig", certs = emptySet())).allowed)
    }

    @Test fun `certificate digests are lower-case hex with colons`() {
        assertEquals(
            "ba:78:16:bf:8f:01:cf:ea:41:41:40:de:5d:ae:22:23:b0:03:61:a3:96:17:7a:9c:b4:10:ff:61:f2:00:15:ad",
            ControllerPolicy.sha256("abc".toByteArray()),
        )
        assertTrue(ControllerPolicy.KNOWN_APPS.values.all { app -> (app.releaseKeys + app.debugKeys).all { Regex("^([0-9a-f]{2}:){31}[0-9a-f]{2}$").matches(it) } })
    }
}
