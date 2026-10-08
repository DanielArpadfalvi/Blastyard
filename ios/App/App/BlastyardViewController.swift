import Capacitor
import UIKit

/// The Capacitor bridge controller with Blastyard's needs (T7.1):
/// - the app's native plugin (`BlastyardSystemPlugin`: keep-awake);
/// - edge swipes (home indicator, control centre) need a second swipe, so table-mode thumbs at
///   the screen edge don't leave the game; the home indicator auto-hides; no status bar;
/// - the web view becomes first responder, which WebKit requires to expose game controllers to
///   the Gamepad API (T5.5).
class BlastyardViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BlastyardSystemPlugin())
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        webView?.becomeFirstResponder()
    }

    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
}
