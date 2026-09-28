import Capacitor
import UIKit

/// Capacitor's bridge view controller, plus what the iPhone app adds on top:
/// the app's own plugins (registered here, since they live in the app target
/// rather than in an npm package) and the theme's colours around the page.
class EmberViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(EmberThemePlugin())
        bridge?.registerPluginInstance(EmberAudioRoutePlugin())
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        // Before the first byte arrives the web view is blank: paint it with
        // the last theme instead of the system's white.
        apply(ShellTheme.load())
    }

    func apply(_ theme: ShellTheme) {
        let color = theme.color
        view.backgroundColor = color
        // Opaque, WKWebView paints white until the page does; see-through,
        // the colour behind it shows instead.
        webView?.isOpaque = false
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
        setStatusBarStyle(theme.statusBarStyle)
    }
}
