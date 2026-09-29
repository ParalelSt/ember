import UIKit

/// The shell's half of the person's Ember theme (the iOS twin of Android's
/// ThemeColors.kt). The page is themed by the server; what is left here is
/// what the page cannot paint: the status bar text and the blank behind the
/// web view before the first HTML byte. The web app reports each theme
/// through EmberThemePlugin.apply and the last one is kept in UserDefaults,
/// so the next cold start opens on it.
///
/// Everything but `store`/`load` is pure, so AppTests can hold it.
struct ShellTheme: Equatable {
    /// Ember's own background (`oklch(0.16 0.005 260)`), for a phone that has
    /// never reported a theme: the first launch opens on Ember, not white.
    static let defaultBackground = "#0c0d0f"
    static let fallback = ShellTheme(background: defaultBackground, scheme: .dark)

    enum Scheme: String { case light, dark }

    /// `#rrggbb`, lower case.
    let background: String
    let scheme: Scheme

    /// Light text on a dark theme and the other way round.
    var statusBarStyle: UIStatusBarStyle {
        scheme == .dark ? .lightContent : .darkContent
    }

    var color: UIColor {
        guard let rgb = ShellTheme.parseHex(background) else { return .black }
        return UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }

    /// `#rrggbb` (either case, surrounding space ignored) as 0xRRGGBB, or nil
    /// for anything else: a colour that cannot be read must not paint.
    static func parseHex(_ hex: String?) -> Int? {
        guard let raw = hex?.trimmingCharacters(in: .whitespaces), raw.count == 7, raw.first == "#" else {
            return nil
        }
        let digits = raw.dropFirst()
        guard digits.allSatisfy({ $0.isHexDigit }) else { return nil }
        return Int(digits, radix: 16)
    }

    /// What the page sent, or nil when the colour is unreadable. Any scheme
    /// other than "light" is dark, like the Android shell.
    static func from(background: String?, scheme: String?) -> ShellTheme? {
        guard parseHex(background) != nil, let bg = background else { return nil }
        let normalized = bg.trimmingCharacters(in: .whitespaces).lowercased()
        return ShellTheme(background: normalized, scheme: scheme == "light" ? .light : .dark)
    }

    private static let backgroundKey = "ember.theme.background"
    private static let schemeKey = "ember.theme.scheme"

    static func load(_ defaults: UserDefaults = .standard) -> ShellTheme {
        from(background: defaults.string(forKey: backgroundKey), scheme: defaults.string(forKey: schemeKey)) ?? fallback
    }

    func store(_ defaults: UserDefaults = .standard) {
        defaults.set(background, forKey: ShellTheme.backgroundKey)
        defaults.set(scheme.rawValue, forKey: ShellTheme.schemeKey)
    }
}
