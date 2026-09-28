import XCTest

/// The lock screen's Now Playing controls, pressed for real on the simulator.
///
/// The iPhone app has no native player: the page's <audio> element plays in
/// WKWebView and WebKit publishes navigator.mediaSession (title, artist,
/// artwork, play/pause/previous/next/seek) to the lock screen. This drives
/// SpringBoard like a person would: locks the phone, presses the lock
/// screen's buttons and drags its scrubber, and checks both what the lock
/// screen shows and, after unlocking, what Ember itself shows.
///
/// Needs a running Ember server with a member account and three 20 second
/// uploads, "Lock Alpha", "Lock Bravo" and "Lock Charlie" (newest first, so
/// the Uploads list plays them in that order). tests/ios-lockscreen-seed.mjs
/// makes them. Environment (pass with the TEST_RUNNER_ prefix to xcodebuild):
///
///   EMBER_TEST_SERVER_URL  the server, e.g. http://127.0.0.1:3190 (required,
///                          the test skips without it)
///   EMBER_TEST_EMAIL       default lock@ember.test
///   EMBER_TEST_PASSWORD    default LockTest2026!
///   EMBER_TEST_SHOTS       a folder for screenshots (optional)
///
/// See docs/APPS.md, "iOS (iPhone app)", for the full command.
final class LockScreenControlsUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard let server = env["EMBER_TEST_SERVER_URL"], !server.isEmpty else {
            throw XCTSkip("EMBER_TEST_SERVER_URL is not set: no Ember server to test against")
        }
        // A hung query (a web view snapshot can stall) fails the test instead
        // of the run; takes effect with -test-timeouts-enabled YES.
        executionTimeAllowance = 300
        if isLocked { unlock() }
        app = XCUIApplication()
        app.launchEnvironment["EMBER_TEST_SERVER_URL"] = server
        app.launch()
        signInIfNeeded()
    }

    override func tearDown() {
        // Leave the simulator unlocked and quiet for whatever runs next.
        if isLocked { unlock() }
        app?.terminate()
        super.tearDown()
    }

    func testLockScreenControlsDriveEmber() throws {
        playFromUploads("Lock Alpha")
        XCTAssertTrue(web.buttons["Pause"].waitForExistence(timeout: 10), "Ember did not start playing")

        // Lock, then wake the screen to see the lock screen.
        lockScreen()
        XCTAssertTrue(wakeScreen(), "no Now Playing on the lock screen")
        XCTAssertTrue(waitForTitle("Lock Alpha"), "lock screen title: \(titleLabel)")
        XCTAssertTrue(titleLabel.contains("Ember Tester"), "artist missing: \(titleLabel)")
        XCTAssertTrue(springboard.otherElements["UIA.MediaControls.ArtworkView"].exists, "no artwork view")
        // Previous and next, not the default skip buttons.
        XCTAssertTrue(button("Previous Track").exists, "no previous button: \(transportLabels)")
        XCTAssertTrue(button("Next Track").exists, "no next button: \(transportLabels)")
        XCTAssertFalse(transportLabels.contains("seconds"), "skip buttons instead of tracks: \(transportLabels)")
        shot("1-locked-playing")

        // Pause: the button flips and the position stops.
        button("Pause").tap()
        XCTAssertTrue(button("Play").waitForExistence(timeout: 5), "pause did not pause: \(transportLabels)")
        let pausedAt = position()
        sleep(3)
        XCTAssertEqual(position(), pausedAt, "position moved while paused")
        shot("2-locked-paused")

        // Play: it runs again.
        button("Play").tap()
        XCTAssertTrue(button("Pause").waitForExistence(timeout: 5), "play did not play")
        XCTAssertTrue(waitFor { self.position() > pausedAt }, "position did not move after play")

        // Next, then previous (early in the song, so it goes back a song
        // rather than restarting this one).
        button("Next Track").tap()
        XCTAssertTrue(waitForTitle("Lock Bravo"), "next did not change the song: \(titleLabel)")
        button("Previous Track").tap()
        XCTAssertTrue(waitForTitle("Lock Alpha"), "previous did not go back: \(titleLabel)")
        XCTAssertTrue(button("Pause").waitForExistence(timeout: 5))

        // Seek: drag the lock screen's scrubber to the middle.
        seek(to: 0.55)
        XCTAssertTrue(waitFor { (10...17).contains(self.position()) }, "seek did not land mid-song: \(position())")
        shot("3-locked-seeked")

        // Screen off (locked, dark) until Alpha ends on its own and Bravo
        // plays for a while: background playback and auto-advance.
        lockScreen()
        sleep(14)
        XCTAssertTrue(wakeScreen(), "no Now Playing after the screen was off")
        XCTAssertTrue(waitForTitle("Lock Bravo"), "did not advance while locked: \(titleLabel)")
        XCTAssertTrue(button("Pause").exists, "not playing after the advance: \(transportLabels)")
        let bravoAt = position()
        XCTAssertGreaterThanOrEqual(bravoAt, 3, "Bravo did not keep playing with the screen off")
        XCTAssertTrue(waitFor { self.position() > bravoAt }, "Bravo is not moving")
        shot("4-locked-after-auto-advance")

        // The controls are still Ember's after the song changed by itself.
        XCTAssertTrue(button("Previous Track").exists && button("Next Track").exists, transportLabels)
        button("Next Track").tap()
        XCTAssertTrue(waitForTitle("Lock Charlie"), "next after auto-advance: \(titleLabel)")
        button("Previous Track").tap()
        XCTAssertTrue(waitForTitle("Lock Bravo"), "previous after auto-advance: \(titleLabel)")

        // A quick scrub all the way to the end finishes Bravo. iOS sends a
        // second seek when the flick lets go; it must not skip Charlie too.
        XCTAssertTrue(button("Pause").waitForExistence(timeout: 5))
        fling(to: 1.0)
        XCTAssertTrue(waitForTitle("Lock Charlie"), "scrub to the end did not move on: \(titleLabel)")
        sleep(3)
        XCTAssertTrue(titleLabel.hasSuffix("Lock Charlie"), "Charlie was skipped: \(titleLabel)")
        XCTAssertTrue(button("Pause").exists, "Charlie is not playing: \(transportLabels)")
        XCTAssertGreaterThanOrEqual(position(), 2, "Charlie did not play from the start")
        XCTAssertLessThan(position(), 15, "Charlie started near its end")
        button("Pause").tap()
        XCTAssertTrue(button("Play").waitForExistence(timeout: 5))
        shot("5-locked-charlie-paused")

        // Ember itself agrees: unlocked, the player shows Charlie, paused.
        unlock()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        let bar = web.otherElements["content information"]
        XCTAssertTrue(bar.staticTexts["Lock Charlie"].waitForExistence(timeout: 10), "Ember's player is not on Charlie")
        XCTAssertTrue(bar.buttons["Play"].exists, "Ember's player is not paused")
        XCTAssertFalse(bar.buttons["Pause"].exists, "Ember's player still shows Pause")
        shot("6-unlocked-ember")
    }

    // MARK: - Ember

    private var web: XCUIElement { app.webViews.firstMatch }

    private func signInIfNeeded() {
        let email = web.textFields["Email"]
        let home = web.links["Library"]
        _ = home.waitForExistence(timeout: 15) || email.exists
        guard email.exists else { return }
        email.tap()
        email.typeText((env["EMBER_TEST_EMAIL"] ?? "lock@ember.test") + "\n")
        let password = web.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15), "no password field")
        password.tap()
        password.typeText((env["EMBER_TEST_PASSWORD"] ?? "LockTest2026!") + "\n")
        XCTAssertTrue(home.waitForExistence(timeout: 20), "sign-in did not land in the app")
    }

    /// Opens Library, then Uploads, and presses the row's own play button.
    private func playFromUploads(_ title: String) {
        web.links["Library"].firstMatch.tap()
        let uploads = web.links.matching(NSPredicate(format: "label BEGINSWITH 'Uploads'")).firstMatch
        XCTAssertTrue(uploads.waitForExistence(timeout: 15), "no Uploads collection")
        uploads.tap()
        let row = web.staticTexts[title]
        XCTAssertTrue(row.waitForExistence(timeout: 15), "no upload called \(title)")
        let y = row.frame.midY
        let play = web.buttons.matching(identifier: "Play").allElementsBoundByIndex
            .first { abs($0.frame.midY - y) < 20 }
        XCTAssertNotNil(play, "no play button on the \(title) row")
        play?.tap()
    }

    // MARK: - Lock screen

    private var nowPlaying: XCUIElement { springboard.otherElements["UIA.MediaControls.LockscreenView"] }

    private func button(_ label: String) -> XCUIElement { nowPlaying.buttons[label] }

    /// The header's label, "Not Playing, <artist>, <title>" on iOS 26 (the
    /// first part is the route's state, not the song's).
    private var titleLabel: String {
        let header = nowPlaying.otherElements.matching(NSPredicate(format: "label CONTAINS 'Ember Tester'")).firstMatch
        return header.exists ? header.label : ""
    }

    private var transportLabels: String {
        nowPlaying.buttons.allElementsBoundByIndex.map(\.label).joined(separator: " | ")
    }

    private var isLocked: Bool { springboard.otherElements["lockscreen-date-view"].exists }

    private func waitForTitle(_ title: String, timeout: TimeInterval = 10) -> Bool {
        let shown = nowPlaying.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS 'Ember Tester' AND label ENDSWITH %@", title)).firstMatch
        if shown.waitForExistence(timeout: timeout) { return true }
        print("Now Playing without \(title):\n\(nowPlaying.debugDescription)")
        return false
    }

    /// The scrubber's position in whole seconds. VoiceOver spells it out
    /// ("fourteen seconds of twenty seconds").
    private func position() -> Int {
        let value = nowPlaying.otherElements["TrackPosition"].value as? String ?? ""
        return SpokenDuration.seconds(in: value.components(separatedBy: " of ").first ?? "") ?? -1
    }

    /// A person's drag: slow, and held before letting go (a fast flick
    /// overshoots to the end).
    private func seek(to fraction: CGFloat) {
        let bar = nowPlaying.otherElements["TrackPosition"]
        bar.coordinate(withNormalizedOffset: CGVector(dx: CGFloat(max(position(), 0)) / 20, dy: 0.5))
            .press(forDuration: 0.5, thenDragTo: bar.coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.5)),
                   withVelocity: 100, thenHoldForDuration: 0.5)
    }

    /// A quick flick of the scrubber.
    private func fling(to fraction: CGFloat) {
        let bar = nowPlaying.otherElements["TrackPosition"]
        bar.coordinate(withNormalizedOffset: CGVector(dx: CGFloat(max(position(), 0)) / 20, dy: 0.5))
            .press(forDuration: 0.3, thenDragTo: bar.coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.5)))
    }

    private func lockScreen() {
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
    }

    /// Wakes the locked screen and waits for Now Playing. The simulator
    /// sometimes wakes to a lock screen without it; locking and waking again
    /// brings it back.
    @discardableResult
    private func wakeScreen() -> Bool {
        for attempt in 0..<3 {
            if attempt > 0 { lockScreen() }
            XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
            if nowPlaying.waitForExistence(timeout: 6) { return true }
        }
        return false
    }

    private func unlock() {
        XCUIDevice.shared.press(.home)
        sleep(1)
        if isLocked { XCUIDevice.shared.press(.home) }
        sleep(2)
    }

    // MARK: - Helpers

    private func waitFor(timeout: TimeInterval = 10, _ condition: @escaping () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            usleep(300_000)
        }
        return condition()
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["EMBER_TEST_SHOTS"], !dir.isEmpty {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}

/// Turns VoiceOver's spoken duration ("one minute, four seconds", "twelve
/// seconds", "zero seconds") into seconds.
enum SpokenDuration {
    private static let units = [
        "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
        "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
        "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    ]
    private static let tens = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50]

    static func number(_ word: String) -> Int? {
        let parts = word.lowercased().split(separator: "-").map(String.init)
        if parts.count == 2, let t = tens[parts[0]], let u = units[parts[1]] { return t + u }
        if parts.count == 1 { return units[parts[0]] ?? tens[parts[0]] }
        return nil
    }

    static func seconds(in text: String) -> Int? {
        var total = 0
        var found = false
        var pending: Int?
        for raw in text.lowercased().split(whereSeparator: { $0 == " " || $0 == "," }) {
            let word = String(raw)
            if let n = number(word) {
                pending = n
            } else if word.hasPrefix("hour"), let n = pending {
                total += n * 3600; pending = nil; found = true
            } else if word.hasPrefix("minute"), let n = pending {
                total += n * 60; pending = nil; found = true
            } else if word.hasPrefix("second"), let n = pending {
                total += n; pending = nil; found = true
            }
        }
        return found ? total : nil
    }
}
