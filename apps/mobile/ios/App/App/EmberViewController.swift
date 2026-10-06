import Capacitor
import UIKit

/// Capacitor's bridge view controller, plus what the iPhone app adds on top:
/// the app's own plugins (registered here, since they live in the app target
/// rather than in an npm package) and the theme's colours around the page.
class EmberViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(EmberThemePlugin())
        bridge?.registerPluginInstance(EmberAudioRoutePlugin())
        bridge?.registerPluginInstance(EmberAppPlugin())
    }

    #if DEBUG
    /// Debug builds only: the UI tests (AppUITests) point the app at a
    /// throwaway local server through the launch environment, so they need
    /// no `cap sync` to a test URL. A release build always loads the server
    /// from capacitor.config.json.
    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let url = ProcessInfo.processInfo.environment["EMBER_TEST_SERVER_URL"], !url.isEmpty {
            descriptor.serverURL = url
        }
        return descriptor
    }
    #endif

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
