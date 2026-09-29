import AVFoundation
import XCTest

/// Runs inside the app (the test bundle is hosted by App.app), so the shared
/// session is the one AppDelegate configured at launch.
final class AudioSessionTests: XCTestCase {
    func testLaunchPutsTheAppInThePlaybackCategory() {
        // Without it the ring/silent switch mutes Ember and the music stops
        // when the screen locks.
        XCTAssertEqual(AVAudioSession.sharedInstance().category, .playback)
    }

    func testConfigureDoesNotMixWithOtherAudio() {
        AudioSession.configure()
        let session = AVAudioSession.sharedInstance()
        XCTAssertEqual(session.category, .playback)
        XCTAssertFalse(session.categoryOptions.contains(.mixWithOthers))
    }

    func testBackgroundAudioModeIsDeclared() {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
        XCTAssertEqual(modes, ["audio"])
    }
}
