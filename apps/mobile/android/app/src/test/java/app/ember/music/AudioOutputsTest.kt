package app.ember.music

import android.media.AudioDeviceInfo.TYPE_AUX_LINE
import android.media.AudioDeviceInfo.TYPE_BLE_BROADCAST
import android.media.AudioDeviceInfo.TYPE_BLE_HEADSET
import android.media.AudioDeviceInfo.TYPE_BLE_SPEAKER
import android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
import android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
import android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
import android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
import android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE
import android.media.AudioDeviceInfo.TYPE_BUS
import android.media.AudioDeviceInfo.TYPE_DOCK
import android.media.AudioDeviceInfo.TYPE_DOCK_ANALOG
import android.media.AudioDeviceInfo.TYPE_FM
import android.media.AudioDeviceInfo.TYPE_HDMI
import android.media.AudioDeviceInfo.TYPE_HDMI_ARC
import android.media.AudioDeviceInfo.TYPE_HDMI_EARC
import android.media.AudioDeviceInfo.TYPE_HEARING_AID
import android.media.AudioDeviceInfo.TYPE_IP
import android.media.AudioDeviceInfo.TYPE_LINE_ANALOG
import android.media.AudioDeviceInfo.TYPE_LINE_DIGITAL
import android.media.AudioDeviceInfo.TYPE_REMOTE_SUBMIX
import android.media.AudioDeviceInfo.TYPE_TELEPHONY
import android.media.AudioDeviceInfo.TYPE_UNKNOWN
import android.media.AudioDeviceInfo.TYPE_USB_ACCESSORY
import android.media.AudioDeviceInfo.TYPE_USB_DEVICE
import android.media.AudioDeviceInfo.TYPE_USB_HEADSET
import android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES
import android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's outputs as the app's device picker lists them: which ones,
 *  under what name, each device once, in what order, and which one music
 *  plays on now. Plain JVM: the AudioDeviceInfo types are compile-time
 *  constants. */
class AudioOutputsTest {
    private val model = "Pixel 8"
    private fun dev(id: Int, type: Int, name: String? = null, address: String? = null, sink: Boolean = true) =
        OutputInfo(id, type, name, address, sink)
    private val speaker = dev(2, TYPE_BUILTIN_SPEAKER, model, "")
    private val earpiece = dev(1, TYPE_BUILTIN_EARPIECE, model, "")

    @Test fun `calls, the screen recorder and other non-music outputs are left out`() {
        val all = listOf(
            earpiece, speaker,
            dev(3, TYPE_BLUETOOTH_SCO, "Buds", "AA:BB"),
            dev(4, TYPE_TELEPHONY, null),
            dev(5, TYPE_REMOTE_SUBMIX, null),
            dev(6, TYPE_BUS, null),
            dev(7, TYPE_FM, null),
            dev(8, TYPE_IP, null),
            dev(9, TYPE_BUILTIN_SPEAKER_SAFE, model),
            dev(10, TYPE_BLE_BROADCAST, "Broadcast"),
            dev(11, TYPE_UNKNOWN, "?"),
            dev(12, TYPE_BLUETOOTH_A2DP, "Buds", "AA:BB"),
            // A source, not a sink: never an output.
            dev(13, TYPE_USB_DEVICE, "Mic", sink = false),
        )
        assertEquals(listOf(2, 12), AudioOutputs.list(all, model).map { it.id }.sorted())
    }

    @Test fun `each kept type maps to its kind`() {
        val kinds = mapOf(
            TYPE_BUILTIN_SPEAKER to "speaker",
            TYPE_WIRED_HEADSET to "headphones", TYPE_WIRED_HEADPHONES to "headphones",
            TYPE_LINE_ANALOG to "headphones", TYPE_LINE_DIGITAL to "headphones",
            TYPE_BLUETOOTH_A2DP to "bluetooth", TYPE_BLE_HEADSET to "bluetooth",
            TYPE_BLE_SPEAKER to "bluetooth", TYPE_HEARING_AID to "bluetooth",
            TYPE_USB_HEADSET to "usb", TYPE_USB_DEVICE to "usb", TYPE_USB_ACCESSORY to "usb",
            TYPE_HDMI to "hdmi", TYPE_HDMI_ARC to "hdmi", TYPE_HDMI_EARC to "hdmi",
            TYPE_DOCK to "other", TYPE_DOCK_ANALOG to "other", TYPE_AUX_LINE to "other",
        )
        for ((type, kind) in kinds) assertEquals("type $type", kind, AudioOutputs.kindOf(type))
        for (type in listOf(TYPE_BUILTIN_EARPIECE, TYPE_BLUETOOTH_SCO, TYPE_TELEPHONY, TYPE_REMOTE_SUBMIX, TYPE_BUS, TYPE_FM, TYPE_IP, TYPE_BLE_BROADCAST, TYPE_BUILTIN_SPEAKER_SAFE)) {
            assertNull("type $type", AudioOutputs.kindOf(type))
        }
    }

    @Test fun `names a person recognises`() {
        fun name(d: OutputInfo) = AudioOutputs.nameOf(d, model)
        assertEquals("This phone", name(speaker))
        assertEquals("This phone", name(dev(2, TYPE_BUILTIN_SPEAKER, null)))
        // Android names wired outputs after the phone itself.
        assertEquals("Wired headphones", name(dev(3, TYPE_WIRED_HEADSET, model)))
        assertEquals("Wired headphones", name(dev(3, TYPE_WIRED_HEADPHONES, "  ")))
        assertEquals("Wired headphones", name(dev(3, TYPE_LINE_ANALOG, null)))
        assertEquals("WH-1000XM4", name(dev(4, TYPE_BLUETOOTH_A2DP, " WH-1000XM4 ")))
        assertEquals("Bluetooth device", name(dev(4, TYPE_BLUETOOTH_A2DP, null)))
        assertEquals("Bluetooth device", name(dev(4, TYPE_BLE_HEADSET, "")))
        assertEquals("Hearing aid", name(dev(4, TYPE_HEARING_AID, null)))
        assertEquals("FiiO K3", name(dev(5, TYPE_USB_DEVICE, "FiiO K3")))
        assertEquals("USB audio", name(dev(5, TYPE_USB_HEADSET, null)))
        assertEquals("Living Room TV", name(dev(6, TYPE_HDMI_ARC, "Living Room TV")))
        assertEquals("HDMI", name(dev(6, TYPE_HDMI, null)))
        assertEquals("Dock", name(dev(7, TYPE_DOCK, null)))
        assertEquals("Line out", name(dev(7, TYPE_AUX_LINE, null)))
    }

    @Test fun `one headset reported as A2DP and LE Audio is listed once`() {
        val list = AudioOutputs.list(listOf(speaker, dev(10, TYPE_BLUETOOTH_A2DP, "Buds", "AA:BB"), dev(11, TYPE_BLE_HEADSET, "Buds", "CC:DD")), model)
        assertEquals(listOf(2, 10), list.map { it.id })
        assertEquals(Output(10, "Buds", "bluetooth"), list[1])
    }

    @Test fun `the two earbuds of an LE Audio pair are listed once`() {
        val list = AudioOutputs.list(listOf(dev(11, TYPE_BLE_HEADSET, "Buds", "L"), dev(12, TYPE_BLE_HEADSET, "Buds", "R")), model)
        assertEquals(listOf(11), list.map { it.id })
    }

    @Test fun `of a duplicate, the pinned or routed entry is the one kept`() {
        val devices = listOf(dev(10, TYPE_BLUETOOTH_A2DP, "Buds"), dev(11, TYPE_BLE_HEADSET, "Buds"))
        assertEquals(listOf(11), AudioOutputs.list(devices, model, keep = listOf(11)).map { it.id })
        assertEquals(listOf(10), AudioOutputs.list(devices, model, keep = listOf(99, 10)).map { it.id })
    }

    @Test fun `different devices, or one name on different kinds, stay apart`() {
        val devices = listOf(
            dev(10, TYPE_BLUETOOTH_A2DP, "Buds"), dev(11, TYPE_BLUETOOTH_A2DP, "Speaker"),
            dev(12, TYPE_USB_HEADSET, "Buds"),
        )
        assertEquals(listOf(10, 11, 12), AudioOutputs.list(devices, model).map { it.id }.sorted())
    }

    @Test fun `current first, then the phone's speaker, then the rest by name`() {
        val devices = listOf(
            dev(10, TYPE_BLUETOOTH_A2DP, "zeta Speaker"), speaker, dev(11, TYPE_USB_DEVICE, "Alpha DAC"),
            dev(12, TYPE_WIRED_HEADSET, model), dev(13, TYPE_BLUETOOTH_A2DP, "beta Buds"),
        )
        assertEquals(listOf(2, 11, 13, 12, 10), AudioOutputs.list(devices, model).map { it.id })
        assertEquals(listOf(13, 2, 11, 12, 10), AudioOutputs.list(devices, model, currentId = 13).map { it.id })
        assertEquals(listOf(2, 11, 13, 12, 10), AudioOutputs.list(devices, model, currentId = 2).map { it.id })
    }

    @Test fun `the pinned output is current while it is there`() {
        val outs = AudioOutputs.list(listOf(speaker, dev(10, TYPE_BLUETOOTH_A2DP, "Buds")), model)
        assertEquals(2, AudioOutputs.current(outs, preferredId = 2, routedIds = listOf(10)))
        // Gone (or deduped away): what Android routes to.
        assertEquals(10, AudioOutputs.current(outs, preferredId = 77, routedIds = listOf(10)))
    }

    @Test fun `from API 33 Android says where media goes`() {
        val outs = AudioOutputs.list(listOf(speaker, dev(10, TYPE_BLUETOOTH_A2DP, "Buds"), dev(11, TYPE_USB_DEVICE, "DAC")), model)
        assertEquals(11, AudioOutputs.current(outs, null, listOf(11, 10)))
        // A routed id not in the list (the earpiece) is passed over.
        assertEquals(2, AudioOutputs.current(outs, null, listOf(1, 2)))
    }

    @Test fun `below API 33 a guess by kind, Bluetooth before USB, wired, HDMI, the speaker`() {
        val bt = dev(10, TYPE_BLUETOOTH_A2DP, "Buds")
        val usb = dev(11, TYPE_USB_DEVICE, "DAC")
        val wired = dev(12, TYPE_WIRED_HEADSET, null)
        val hdmi = dev(13, TYPE_HDMI, null)
        fun cur(vararg d: OutputInfo) = AudioOutputs.current(AudioOutputs.list(d.toList(), model), null, null)
        assertEquals(10, cur(speaker, hdmi, wired, usb, bt))
        assertEquals(11, cur(speaker, hdmi, wired, usb))
        assertEquals(12, cur(speaker, hdmi, wired))
        assertEquals(13, cur(speaker, hdmi))
        assertEquals(2, cur(speaker))
        // Android 13+ with nothing it can say still falls back to the guess.
        assertEquals(10, AudioOutputs.current(AudioOutputs.list(listOf(speaker, bt), model), null, emptyList()))
        assertNull(AudioOutputs.current(emptyList(), 2, listOf(2)))
    }

    @Test fun `routed devices match by id, else by type and address`() {
        val devices = listOf(speaker, dev(10, TYPE_BLUETOOTH_A2DP, "Buds", "AA:BB"), dev(11, TYPE_BLUETOOTH_A2DP, "Other", "CC:DD"))
        assertEquals(listOf(10), AudioOutputs.routedIds(devices, listOf(RoutedOutput(10, TYPE_BLUETOOTH_A2DP, "AA:BB"))))
        assertEquals(listOf(11), AudioOutputs.routedIds(devices, listOf(RoutedOutput(500, TYPE_BLUETOOTH_A2DP, "CC:DD"))))
        assertEquals(listOf(2), AudioOutputs.routedIds(devices, listOf(RoutedOutput(501, TYPE_BUILTIN_SPEAKER, null))))
        assertEquals(emptyList<Int>(), AudioOutputs.routedIds(devices, listOf(RoutedOutput(502, TYPE_USB_DEVICE, ""))))
    }

    @Test fun `the snapshot puts current first and drops a pin that is gone`() {
        val devices = listOf(speaker, dev(10, TYPE_BLUETOOTH_A2DP, "Buds", "AA:BB"), dev(11, TYPE_BLE_HEADSET, "Buds", "EE:FF"))
        val pinned = AudioOutputs.snapshot(devices, preferredId = 2, routed = listOf(RoutedOutput(11, TYPE_BLE_HEADSET, "EE:FF")), sdk = 34, phoneModel = model)
        assertEquals(2, pinned.currentId)
        assertEquals(2, pinned.preferredId)
        // The routed entry of the duplicate headset is the one kept.
        assertEquals(listOf(2, 11), pinned.outputs.map { it.id })
        assertTrue(pinned.systemSwitcher)

        val auto = AudioOutputs.snapshot(devices, preferredId = null, routed = listOf(RoutedOutput(11, TYPE_BLE_HEADSET, "EE:FF")), sdk = 34, phoneModel = model)
        assertEquals(11, auto.currentId)
        assertEquals(listOf(11, 2), auto.outputs.map { it.id })
        assertNull(auto.preferredId)

        val gone = AudioOutputs.snapshot(devices, preferredId = 99, routed = null, sdk = 29, phoneModel = model)
        assertNull(gone.preferredId)
        assertEquals(10, gone.currentId)
        assertFalse(gone.systemSwitcher)
        assertTrue(AudioOutputs.snapshot(devices, null, null, 30, model).systemSwitcher)

        val none = AudioOutputs.snapshot(emptyList(), null, null, 34, model)
        assertEquals(emptyList<Output>(), none.outputs)
        assertNull(none.currentId)
    }
}

/** The service's pinned output: set, cleared, let go when unplugged. */
class OutputPreferenceTest {
    private val connected = mutableSetOf(2, 10)
    private val routed = ArrayList<Int?>()
    private var published = 0
    private val pref = OutputPreference(
        route = { id -> if (id == null || id in connected) { routed.add(id); true } else false },
        publish = { published++ },
    )

    @Test fun `starts automatic`() {
        assertNull(pref.id)
        assertEquals(-1, pref.extra)
    }

    @Test fun `pins a connected output and tells the app once`() {
        assertTrue(pref.set(10))
        assertEquals(10, pref.id)
        assertEquals(10, pref.extra)
        assertEquals(listOf<Int?>(10), routed)
        assertEquals(1, published)
        // The same pin again re-applies it but is no news.
        assertTrue(pref.set(10))
        assertEquals(1, published)
    }

    @Test fun `an output that is not connected changes nothing`() {
        pref.set(10)
        assertFalse(pref.set(55))
        assertEquals(10, pref.id)
        assertEquals(1, published)
    }

    @Test fun `null or -1 is automatic again`() {
        pref.set(10)
        assertTrue(pref.set(-1))
        assertNull(pref.id)
        assertEquals(-1, pref.extra)
        assertTrue(pref.set(null))
        assertEquals(listOf(10, null, null), routed)
        assertEquals(2, published)
    }

    @Test fun `unplugging the pinned output goes back to automatic`() {
        pref.set(10)
        pref.onRemoved(listOf(10, 11))
        assertNull(pref.id)
        assertEquals(listOf(10, null), routed)
        assertEquals(2, published)
    }

    @Test fun `unplugging something else leaves the pin`() {
        pref.set(10)
        pref.onRemoved(listOf(2))
        assertEquals(10, pref.id)
        assertEquals(1, published)
        // Nothing pinned: nothing to do.
        pref.set(null)
        pref.onRemoved(listOf(10))
        assertEquals(listOf(10, null), routed)
    }
}

/** Which MediaRouter routes the app's picker lists as cast devices. */
class CastDevicesTest {
    private fun route(
        id: String, name: String = id, description: String? = null, enabled: Boolean = true,
        isDefault: Boolean = false, isBluetooth: Boolean = false, isSystem: Boolean = false,
        matches: Boolean = true, selected: Boolean = false, state: Int = 0,
    ) = CastRoute(id, name, description, enabled, isDefault, isBluetooth, isSystem, matches, selected, state)

    @Test fun `only usable cast routes, never the phone's own`() {
        val routes = listOf(
            route("tv", "Living Room TV"),
            route("phone", "Phone", isDefault = true, isSystem = true),
            route("bt", "Buds", isBluetooth = true, isSystem = true),
            route("sys", "Speaker", isSystem = true),
            route("other-app", "Other", matches = false),
            route("busy", "Kitchen", enabled = false),
        )
        assertEquals(listOf("tv"), CastDevices.list(routes).map { it.id })
    }

    @Test fun `selected and connecting are carried, by name`() {
        val list = CastDevices.list(listOf(
            route("b", "kitchen speaker", description = "  ", selected = true, state = 2),
            route("a", "Bedroom TV", description = "Chromecast", state = 1),
        ))
        assertEquals(
            listOf(
                CastDevice("a", "Bedroom TV", "Chromecast", selected = false, connecting = true),
                CastDevice("b", "kitchen speaker", null, selected = true, connecting = false),
            ),
            list,
        )
    }
}
