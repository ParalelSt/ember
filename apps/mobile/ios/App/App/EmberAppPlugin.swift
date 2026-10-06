import Capacitor
import Foundation

/// The page asks which app it runs in (apps/web/lib/shellVersion.ts):
/// `info()` answers `{ version }`, the app's CFBundleShortVersionString,
/// shown in the settings footer after the web build. Same name and call as
/// the Android plugin. An app build from before this plugin has none, and
/// the page then shows the web build alone.
@objc(EmberAppPlugin)
public class EmberAppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EmberAppPlugin"
    public let jsName = "EmberApp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise)
    ]

    @objc func info(_ call: CAPPluginCall) {
        let raw = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        guard let version = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !version.isEmpty else {
            call.reject("the app has no version", "no-version")
            return
        }
        call.resolve(["version": version])
    }
}
