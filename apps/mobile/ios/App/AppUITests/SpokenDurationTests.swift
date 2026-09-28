import XCTest

/// The lock screen's scrubber position as VoiceOver reads it. No app, no
/// server: runs with the rest of AppUITests but needs neither.
final class SpokenDurationTests: XCTestCase {
    func testReadsSpokenSeconds() {
        XCTAssertEqual(SpokenDuration.seconds(in: "zero seconds"), 0)
        XCTAssertEqual(SpokenDuration.seconds(in: "one second"), 1)
        XCTAssertEqual(SpokenDuration.seconds(in: "fourteen seconds"), 14)
        XCTAssertEqual(SpokenDuration.seconds(in: "twenty seconds"), 20)
        XCTAssertEqual(SpokenDuration.seconds(in: "forty-two seconds"), 42)
    }

    func testReadsMinutesAndHours() {
        XCTAssertEqual(SpokenDuration.seconds(in: "one minute, four seconds"), 64)
        XCTAssertEqual(SpokenDuration.seconds(in: "three minutes"), 180)
        XCTAssertEqual(SpokenDuration.seconds(in: "one hour, two minutes, fifty-nine seconds"), 3779)
    }

    func testRejectsWhatIsNotADuration() {
        XCTAssertNil(SpokenDuration.seconds(in: ""))
        XCTAssertNil(SpokenDuration.seconds(in: "Track position"))
        XCTAssertNil(SpokenDuration.seconds(in: "seconds"))
    }
}
