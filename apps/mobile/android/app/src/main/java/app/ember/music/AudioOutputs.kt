package app.ember.music

import android.media.AudioDeviceInfo
import androidx.mediarouter.media.MediaRouter

/** One output as AudioManager reports it (an AudioDeviceInfo), in plain
 *  ints and strings so the choices below run in a plain JVM test. [type] is
 *  an AudioDeviceInfo.TYPE_* constant. */
data class OutputInfo(
    val id: Int,
    val type: Int,
    val productName: String?,
    val address: String?,
    val isSink: Boolean = true,
)

/** A device Android says it routes media to now (getAudioDevicesForAttributes,
 *  API 33+). Its id should be the one getDevices reports, but it comes from
 *  another call, so it is matched back by type and address when it is not. */
data class RoutedOutput(val id: Int, val type: Int, val address: String?)

/** One row of the app's output picker: `{ id, name, kind }`. */
data class Output(val id: Int, val name: String, val kind: String)

/** What getOutputs resolves and the `outputs` event sends. */
data class OutputSnapshot(
    val outputs: List<Output>,
    val currentId: Int?,
    val preferredId: Int?,
    val systemSwitcher: Boolean,
)

/** The phone's own audio outputs, the Spotify-style device picker's list.
 *
 *  AudioManager lists every endpoint the audio system knows of: the call
 *  earpiece, the Bluetooth call profile, the telephony uplink, the screen
 *  recorder's submix. Only the ones a listener would pick for music are
 *  shown, each once, with a name a person recognises. */
object AudioOutputs {
    const val SPEAKER = "speaker"
    const val HEADPHONES = "headphones"
    const val BLUETOOTH = "bluetooth"
    const val USB = "usb"
    const val HDMI = "hdmi"
    const val OTHER = "other"

    /** The kind of each type shown, or null for a type that is left out.
     *
     *  Left out: the earpiece, Bluetooth SCO and telephony (calls), remote
     *  submix (screen recording), bus, FM, IP and the echo reference (not a
     *  place a person plays music), the "safe" speaker (alarms only), and an
     *  LE Audio broadcast (Auracast: it goes to anyone nearby, and Android
     *  starts one from its own Bluetooth settings, not from an app).
     *
     *  Hearing aids count as Bluetooth: they connect over it (ASHA or LE
     *  Audio), and an LE Audio pair can show up as a hearing aid and a BLE
     *  headset at once, which only dedupes if both are the same kind. */
    fun kindOf(type: Int): String? = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> SPEAKER
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_LINE_ANALOG,
        AudioDeviceInfo.TYPE_LINE_DIGITAL -> HEADPHONES
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLE_SPEAKER,
        AudioDeviceInfo.TYPE_HEARING_AID -> BLUETOOTH
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_USB_ACCESSORY -> USB
        AudioDeviceInfo.TYPE_HDMI,
        AudioDeviceInfo.TYPE_HDMI_ARC,
        AudioDeviceInfo.TYPE_HDMI_EARC -> HDMI
        AudioDeviceInfo.TYPE_DOCK,
        AudioDeviceInfo.TYPE_DOCK_ANALOG,
        AudioDeviceInfo.TYPE_AUX_LINE -> OTHER
        else -> null
    }

    /** The name shown for [d]. The phone's own speaker is "This phone" (its
     *  product name is the phone's model). Android also gives wired and
     *  built-in outputs the phone's model as their product name, so a name
     *  equal to [phoneModel] counts as no name at all. */
    fun nameOf(d: OutputInfo, phoneModel: String?): String {
        val kind = kindOf(d.type)
        if (kind == SPEAKER) return "This phone"
        val given = d.productName?.trim()?.takeIf { it.isNotEmpty() && !it.equals(phoneModel?.trim(), ignoreCase = true) }
        if (given != null) return given
        return when (kind) {
            HEADPHONES -> "Wired headphones"
            BLUETOOTH -> if (d.type == AudioDeviceInfo.TYPE_HEARING_AID) "Hearing aid" else "Bluetooth device"
            USB -> "USB audio"
            HDMI -> "HDMI"
            else -> when (d.type) {
                AudioDeviceInfo.TYPE_AUX_LINE -> "Line out"
                else -> "Dock"
            }
        }
    }

    /** The outputs to show, each physical device once, current first, then
     *  the phone's speaker, then the rest by name.
     *
     *  One device can be listed several times: a Bluetooth headset as A2DP
     *  and as LE Audio, or each earbud of an LE Audio pair on its own. These
     *  come with different addresses, so the address cannot tell them apart;
     *  the kind and the shown name do. Two rows with one name would be a coin
     *  toss for the listener anyway. Of a group, the entry kept is the one in
     *  [keep] (the pinned device, then what Android routes to), else the
     *  first reported. */
    fun list(devices: List<OutputInfo>, phoneModel: String?, keep: List<Int> = emptyList(), currentId: Int? = null): List<Output> {
        val groups = LinkedHashMap<Pair<String, String>, MutableList<OutputInfo>>()
        for (d in devices) {
            if (!d.isSink) continue
            val kind = kindOf(d.type) ?: continue
            groups.getOrPut(kind to nameOf(d, phoneModel).lowercase()) { ArrayList() }.add(d)
        }
        val picked = groups.values.map { group ->
            val d = keep.firstNotNullOfOrNull { id -> group.firstOrNull { it.id == id } } ?: group.first()
            Output(d.id, nameOf(d, phoneModel), kindOf(d.type)!!)
        }
        return picked.sortedWith(
            compareBy<Output>({ if (it.id == currentId) 0 else if (it.kind == SPEAKER) 1 else 2 }, { it.name.lowercase() }, { it.id }),
        )
    }

    /** The ids of [routed] among [devices]: by id, else an output of the
     *  same type whose address is the same (or either has none, as the
     *  built-in speaker usually does). */
    fun routedIds(devices: List<OutputInfo>, routed: List<RoutedOutput>): List<Int> = routed.mapNotNull { r ->
        devices.firstOrNull { it.id == r.id }?.id
            ?: devices.firstOrNull { d ->
                d.type == r.type && (r.address.isNullOrEmpty() || d.address.isNullOrEmpty() || r.address == d.address)
            }?.id
    }

    /** Which kind Android is likeliest to play on when it does not say
     *  (below API 33): the last thing plugged in or paired usually wins over
     *  the speaker. */
    private val HEURISTIC = listOf(BLUETOOTH, USB, HEADPHONES, HDMI, OTHER, SPEAKER)

    /** The output music plays on now, among [outputs]: the pinned one while
     *  it is still there; else the first of what Android says it routes media
     *  to ([routedIds], API 33+, null below); else a guess by kind. */
    fun current(outputs: List<Output>, preferredId: Int?, routedIds: List<Int>?): Int? {
        if (outputs.isEmpty()) return null
        if (preferredId != null && outputs.any { it.id == preferredId }) return preferredId
        routedIds?.firstOrNull { id -> outputs.any { it.id == id } }?.let { return it }
        for (kind in HEURISTIC) outputs.firstOrNull { it.kind == kind }?.let { return it.id }
        return outputs.first().id
    }

    /** Everything the picker needs, from what AudioManager reports.
     *  [routed] is null below API 33 (Android does not say). The system
     *  output switcher exists from Android 11 (API 30). */
    fun snapshot(
        devices: List<OutputInfo>,
        preferredId: Int?,
        routed: List<RoutedOutput>?,
        sdk: Int,
        phoneModel: String?,
    ): OutputSnapshot {
        val routedIds = routed?.let { routedIds(devices, it) }
        val keep = listOfNotNull(preferredId) + routedIds.orEmpty()
        val unordered = list(devices, phoneModel, keep)
        val currentId = current(unordered, preferredId, routedIds)
        val outputs = list(devices, phoneModel, keep, currentId)
        return OutputSnapshot(
            outputs = outputs,
            currentId = currentId,
            preferredId = preferredId?.takeIf { id -> outputs.any { it.id == id } },
            systemSwitcher = sdk >= 30,
        )
    }
}

/** The output the app pinned (the picker's choice), kept by the player
 *  service, which owns the player.
 *
 *  [route] points the player at the device with that id, or back at
 *  Android's own routing for null; it answers false when no such device is
 *  connected. [publish] tells the app (the session extras) after a change.
 *
 *  Never kept across a restart of the service: devices come and go, their
 *  ids change when they reconnect, and Android's own routing is the sane
 *  default for a fresh start. */
class OutputPreference(
    private val route: (Int?) -> Boolean,
    private val publish: () -> Unit,
) {
    /** The pinned device's id, null for automatic. */
    var id: Int? = null
        private set

    /** The session extra's value: the id, or -1 for automatic. */
    val extra: Int get() = id ?: -1

    /** Pins [deviceId], or goes back to automatic for null or a negative id.
     *  False (and nothing changes) when that device is not connected. */
    fun set(deviceId: Int?): Boolean {
        val next = deviceId?.takeIf { it >= 0 }
        if (!route(next)) return false
        val changed = next != id
        id = next
        if (changed) publish()
        return true
    }

    /** Devices went away: when the pinned one is among them, the player goes
     *  back to Android's routing (which moves to the speaker or whatever is
     *  left, as it would for any app). */
    fun onRemoved(removedIds: Collection<Int>) {
        val pinned = id ?: return
        if (pinned !in removedIds) return
        id = null
        route(null)
        publish()
    }
}

/** A MediaRouter route in plain values, so which ones the picker lists can
 *  be tested without the router. [connectionState] is a
 *  MediaRouter.RouteInfo.CONNECTION_STATE_* value. */
data class CastRoute(
    val id: String,
    val name: String,
    val description: String?,
    val enabled: Boolean,
    val isDefault: Boolean,
    val isBluetooth: Boolean,
    val isSystem: Boolean,
    val matchesSelector: Boolean,
    val selected: Boolean,
    val connectionState: Int,
)

/** One cast device in the app's picker: `{ id, name, description, selected, connecting }`. */
data class CastDevice(val id: String, val name: String, val description: String?, val selected: Boolean, val connecting: Boolean)

object CastDevices {
    /** The cast devices to list: routes the Cast framework can use (they
     *  match its selector), that can be picked now, and that are not the
     *  phone's own outputs (the default route, Bluetooth, and other system
     *  routes, which the output list already shows). By name. */
    fun list(routes: List<CastRoute>): List<CastDevice> = routes
        .filter { it.matchesSelector && it.enabled && !it.isDefault && !it.isBluetooth && !it.isSystem }
        .map { CastDevice(it.id, it.name, it.description?.trim()?.takeIf { d -> d.isNotEmpty() }, it.selected, it.connectionState == MediaRouter.RouteInfo.CONNECTION_STATE_CONNECTING) }
        .sortedWith(compareBy({ it.name.lowercase() }, { it.id }))
}
