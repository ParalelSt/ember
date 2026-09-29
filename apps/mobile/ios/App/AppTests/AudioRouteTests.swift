import AVFoundation
import XCTest

/// What the Devices picker says about the iPhone's current route
/// (AudioRoute.swift): the web page shows this name and picks an icon by kind.
final class AudioRouteTests: XCTestCase {
    func testTheBuiltInSpeakerIsThePhoneItself() {
        let r = AudioRoute.describe(port: .builtInSpeaker, portName: "Speaker", device: "iPhone")
        XCTAssertEqual(r, AudioRoute(kind: "speaker", name: "This iPhone", airplay: false))
        XCTAssertEqual(AudioRoute.describe(port: .builtInReceiver, portName: "Receiver", device: "iPad").name, "This iPad")
    }

    func testBluetoothKeepsTheDevicesOwnName() {
        for port: AVAudioSession.Port in [.bluetoothA2DP, .bluetoothLE, .bluetoothHFP] {
            let r = AudioRoute.describe(port: port, portName: "AirPods Pro", device: "iPhone")
            XCTAssertEqual(r.kind, "bluetooth")
            XCTAssertEqual(r.name, "AirPods Pro")
        }
        XCTAssertEqual(AudioRoute.describe(port: .bluetoothA2DP, portName: "  ", device: "iPhone").name, "Bluetooth device")
    }

    func testAirPlayCarUsbHdmiAndWired() {
        XCTAssertEqual(AudioRoute.describe(port: .airPlay, portName: "Living Room", device: "iPhone"),
                       AudioRoute(kind: "airplay", name: "Living Room", airplay: true))
        XCTAssertEqual(AudioRoute.describe(port: .carAudio, portName: "", device: "iPhone").name, "CarPlay")
        XCTAssertEqual(AudioRoute.describe(port: .usbAudio, portName: "DAC", device: "iPhone").kind, "usb")
        XCTAssertEqual(AudioRoute.describe(port: .HDMI, portName: "", device: "iPhone").kind, "hdmi")
        XCTAssertEqual(AudioRoute.describe(port: .headphones, portName: "Headphones", device: "iPhone").kind, "headphones")
    }

    func testTheJsonTheWebPageReads() {
        let json = AudioRoute(kind: "airplay", name: "Kitchen", airplay: true).json
        XCTAssertEqual(json["name"] as? String, "Kitchen")
        XCTAssertEqual(json["kind"] as? String, "airplay")
        XCTAssertEqual(json["airplay"] as? Bool, true)
    }

    func testTheSessionsRouteDescribesItself() {
        // Whatever the simulator routes to, it is described, never empty.
        let r = AudioRoute.current(AVAudioSession.sharedInstance().currentRoute, device: "iPhone")
        XCTAssertFalse(r.name.isEmpty)
        XCTAssertFalse(r.kind.isEmpty)
    }
}
