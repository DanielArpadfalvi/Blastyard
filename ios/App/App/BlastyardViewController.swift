import Capacitor
import UIKit

/// The Capacitor bridge controller with the app's own native plugin (T7.1).
class BlastyardViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BlastyardSystemPlugin())
    }
}

/// The window's root (T7.1): hosts the bridge controller as a child and owns the system
/// appearance the bridge controller does not let subclasses change –
/// - edge swipes (home indicator, control centre) need a second swipe, so table-mode thumbs at
///   the screen edge don't leave the game; the home indicator auto-hides; no status bar;
/// - the web view becomes first responder, which WebKit requires to expose game controllers to
///   the Gamepad API (T5.5).
class BlastyardRootViewController: UIViewController {
    let bridgeController = BlastyardViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(bridgeController)
        bridgeController.view.frame = view.bounds
        bridgeController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(bridgeController.view)
        bridgeController.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        bridgeController.webView?.becomeFirstResponder()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
    override var childForStatusBarHidden: UIViewController? { nil }
    override var childForHomeIndicatorAutoHidden: UIViewController? { nil }
    override var childForScreenEdgesDeferringSystemGestures: UIViewController? { nil }
    // The bridge controller tracks the orientation lock of @capacitor/screen-orientation.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        bridgeController.supportedInterfaceOrientations
    }
}
