import Capacitor
import Foundation

/// The page reports its theme here after every change (apps/web/lib/theme/
/// native.ts): `apply({ background: '#rrggbb', scheme, vars: '<json>' })`.
/// Same name and call as the Android plugin, so the web side needs nothing
/// new. `vars` is only used by Android's bundled offline page; iOS has no
/// offline mode, so it is ignored here.
@objc(EmberThemePlugin)
public class EmberThemePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EmberThemePlugin"
    public let jsName = "EmberTheme"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise)
    ]

    @objc func apply(_ call: CAPPluginCall) {
        let background = call.getString("background")
        guard let theme = ShellTheme.from(background: background, scheme: call.getString("scheme")) else {
            call.reject("not a colour: \(background ?? "nil")", "bad-colour")
            return
        }
        theme.store()
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? EmberViewController)?.apply(theme)
            call.resolve()
        }
    }
}
