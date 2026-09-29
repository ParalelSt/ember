import AVFoundation
import AVKit
import Capacitor
import UIKit

/// The Devices button on the iPhone (apps/web/lib/outputs/ios.ts):
/// - `getRoute()` answers `{ name, kind, airplay }`, where the sound goes now;
/// - `showRoutePicker()` opens iOS's own route picker (AirPlay speakers and
///   TVs, Bluetooth headphones, the phone), the same list as the AirPlay
///   button in Control Center;
/// - the `route` event carries the new route whenever it changes (a picker
///   choice, headphones plugged in or taken off).
/// An app build without this plugin has none of it, and the web page then
/// shows no output picker.
@objc(EmberAudioRoutePlugin)
public class EmberAudioRoutePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EmberAudioRoutePlugin"
    public let jsName = "EmberAudioRoute"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRoutePicker", returnType: CAPPluginReturnPromise),
    ]

    /// Kept in the view hierarchy (1 point, invisible): AVRoutePickerView
    /// only presents its list from a view that is on screen.
    private var picker: AVRoutePickerView?

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(routeChanged),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func currentRoute() -> AudioRoute {
        AudioRoute.current(AVAudioSession.sharedInstance().currentRoute, device: UIDevice.current.model)
    }

    @objc private func routeChanged(_ note: Notification) {
        notifyListeners("route", data: currentRoute().json)
    }

    @objc func getRoute(_ call: CAPPluginCall) {
        call.resolve(currentRoute().json)
    }

    @objc func showRoutePicker(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.bridge?.viewController?.view else {
                call.reject("the app is not on screen", "no-view")
                return
            }
            let picker = self.picker ?? {
                let p = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
                p.alpha = 0.011
                p.isUserInteractionEnabled = false
                p.prioritizesVideoDevices = false
                self.picker = p
                return p
            }()
            if picker.superview !== host { host.addSubview(picker) }
            // The picker has no API to open itself: its own button does it.
            guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
                call.reject("the route picker has no button on this iOS", "no-button")
                return
            }
            button.sendActions(for: .touchUpInside)
            call.resolve()
        }
    }
}
