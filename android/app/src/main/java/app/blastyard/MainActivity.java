package app.blastyard;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The Capacitor activity: immersive full screen (no status / navigation bar until swiped in) and
 * the app's own native plugin. Keep-awake and system-gesture exclusion are driven from the web
 * layer through {@link BlastyardSystemPlugin} (only during lobby and matches).
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BlastyardSystemPlugin.class);
    super.onCreate(savedInstanceState);
    hideSystemBars();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }

  private void hideSystemBars() {
    WindowInsetsControllerCompat c =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    c.hide(WindowInsetsCompat.Type.systemBars());
  }
}
