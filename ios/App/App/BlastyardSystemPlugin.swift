import Capacitor
import UIKit

/// Native side of `src/platform/system.ts` (T7.1), iOS:
/// - `setKeepAwake({ on })` disables the idle timer during lobby and matches only;
/// - `setGestureExclusion` is a no-op: `BlastyardViewController` defers the system edge
///   gestures for the whole screen.
@objc(BlastyardSystemPlugin)
public class BlastyardSystemPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BlastyardSystemPlugin"
    public let jsName = "BlastyardSystem"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGestureExclusion", returnType: CAPPluginReturnPromise),
    ]

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    @objc func setGestureExclusion(_ call: CAPPluginCall) {
        call.resolve()
    }
}
