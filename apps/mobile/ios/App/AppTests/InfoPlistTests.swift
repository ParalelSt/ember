import XCTest

/// The app's Info.plist as built (Bundle.main is App.app when hosted).
final class InfoPlistTests: XCTestCase {
    private func value(_ key: String) -> Any? {
        Bundle.main.object(forInfoDictionaryKey: key)
    }

    func testBundleIdentifierMatchesAndroid() {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.ember.music")
    }

    func testDeclaresNoNonExemptEncryption() {
        // Only the OS's HTTPS: keeps TestFlight from asking on every upload.
        XCTAssertEqual(value("ITSAppUsesNonExemptEncryption") as? Bool, false)
    }

    func testCameraAndMicrophoneStringsExist() {
        // A file picker (profile photo, playlist cover, bug report) can offer
        // the camera; without these strings iOS kills the app when chosen.
        XCTAssertFalse((value("NSCameraUsageDescription") as? String ?? "").isEmpty)
        XCTAssertFalse((value("NSMicrophoneUsageDescription") as? String ?? "").isEmpty)
    }

    func testNoBlanketArbitraryLoads() {
        // configure-ats.sh only ever adds one host or local networking.
        let ats = value("NSAppTransportSecurity") as? [String: Any] ?? [:]
        XCTAssertNil(ats["NSAllowsArbitraryLoads"])
        XCTAssertNil(ats["NSAllowsArbitraryLoadsInWebContent"])
    }
}
