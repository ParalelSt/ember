import UIKit
import XCTest

final class ShellThemeTests: XCTestCase {
    func testParsesSixDigitHexInEitherCase() {
        XCTAssertEqual(ShellTheme.parseHex("#0c0d0f"), 0x0c0d0f)
        XCTAssertEqual(ShellTheme.parseHex("#FFaa00"), 0xffaa00)
        XCTAssertEqual(ShellTheme.parseHex("  #123456 "), 0x123456)
    }

    func testRejectsAnythingThatIsNotRrggbb() {
        for bad in [nil, "", "#fff", "0c0d0f", "#0c0d0g", "#0c0d0f0", "red", "#-12345"] as [String?] {
            XCTAssertNil(ShellTheme.parseHex(bad), "\(bad ?? "nil") should not parse")
        }
    }

    func testDarkThemeGetsLightStatusBarText() {
        XCTAssertEqual(ShellTheme(background: "#0c0d0f", scheme: .dark).statusBarStyle, .lightContent)
        XCTAssertEqual(ShellTheme(background: "#fafafa", scheme: .light).statusBarStyle, .darkContent)
    }

    func testFromNormalisesAndDefaultsToDark() {
        XCTAssertEqual(ShellTheme.from(background: " #ABCDEF", scheme: "light"), ShellTheme(background: "#abcdef", scheme: .light))
        XCTAssertEqual(ShellTheme.from(background: "#abcdef", scheme: "sepia"), ShellTheme(background: "#abcdef", scheme: .dark))
        XCTAssertEqual(ShellTheme.from(background: "#abcdef", scheme: nil)?.scheme, .dark)
        XCTAssertNil(ShellTheme.from(background: "blue", scheme: "dark"))
    }

    func testColourComponents() {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ShellTheme(background: "#ff8000", scheme: .dark).color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 1, accuracy: 0.001)
        XCTAssertEqual(g, 128.0 / 255, accuracy: 0.001)
        XCTAssertEqual(b, 0, accuracy: 0.001)
        XCTAssertEqual(a, 1, accuracy: 0.001)
    }

    func testStoreAndLoadRoundTrip() {
        let defaults = UserDefaults(suiteName: "ember.tests.\(UUID().uuidString)")!
        XCTAssertEqual(ShellTheme.load(defaults), ShellTheme.fallback, "a phone that never reported a theme opens on Ember's own")
        ShellTheme(background: "#fafafa", scheme: .light).store(defaults)
        XCTAssertEqual(ShellTheme.load(defaults), ShellTheme(background: "#fafafa", scheme: .light))
    }

    func testFallbackIsEmbersOwnDarkBackground() {
        XCTAssertEqual(ShellTheme.fallback.background, "#0c0d0f")
        XCTAssertEqual(ShellTheme.fallback.scheme, .dark)
    }
}
