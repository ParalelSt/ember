import AVFoundation

/// Where the iPhone app's sound goes right now, as the web page's Devices
/// picker shows it (apps/web/lib/outputs/ios.ts): a name and a kind.
///
/// iOS does not let an app list or pick outputs itself; the system route
/// picker (AVRoutePickerView, EmberAudioRoutePlugin) does the picking, and
/// the web page's audio follows the app's route. This only describes the
/// route AVAudioSession reports, so it is kept apart from UIKit and tested
/// on its own.
struct AudioRoute: Equatable {
    /// "speaker", "headphones", "bluetooth", "airplay", "car", "usb",
    /// "hdmi" or "other": the web's OutputKind names (the phone's own
    /// speaker is "speaker").
    let kind: String
    let name: String
    let airplay: Bool

    /// The route for one output port. `device` is what the phone calls
    /// itself ("iPhone", "iPad"), for the built-in speaker.
    static func describe(port: AVAudioSession.Port, portName: String, device: String) -> AudioRoute {
        let named = portName.trimmingCharacters(in: .whitespacesAndNewlines)
        func route(_ kind: String, _ fallback: String) -> AudioRoute {
            AudioRoute(kind: kind, name: named.isEmpty ? fallback : named, airplay: kind == "airplay")
        }
        switch port {
        case .builtInSpeaker, .builtInReceiver:
            // iOS names these "Speaker" and "Receiver"; "This iPhone" says
            // what the listener needs to know.
            return AudioRoute(kind: "speaker", name: "This \(device)", airplay: false)
        case .headphones:
            return route("headphones", "Headphones")
        case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP:
            return route("bluetooth", "Bluetooth device")
        case .airPlay:
            return route("airplay", "AirPlay")
        case .carAudio:
            return route("car", "CarPlay")
        case .usbAudio:
            return route("usb", "USB audio")
        case .HDMI:
            return route("hdmi", "HDMI")
        case .lineOut:
            return route("headphones", "Line out")
        default:
            return route("other", "Audio output")
        }
    }

    /// The route from AVAudioSession's current route: its first output (the
    /// one music plays on). No output at all (nothing active yet) reads as
    /// the phone's own speaker, which is where the music would start.
    static func current(_ description: AVAudioSessionRouteDescription, device: String) -> AudioRoute {
        guard let port = description.outputs.first else {
            return AudioRoute(kind: "speaker", name: "This \(device)", airplay: false)
        }
        return describe(port: port.portType, portName: port.portName, device: device)
    }

    /// `{ name, kind, airplay }` for the plugin's answer and its `route` event.
    var json: [String: Any] {
        ["name": name, "kind": kind, "airplay": airplay]
    }
}
