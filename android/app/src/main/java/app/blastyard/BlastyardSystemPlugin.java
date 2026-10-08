package app.blastyard;

import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Native side of `src/platform/system.ts` (T7.1):
 * - setKeepAwake({ on }): keeps the screen on during lobby and matches only;
 * - setGestureExclusion({ rects }): the control zones near the screen edges (CSS px of the web
 *   view) are excluded from the back / home edge swipes (Android 10+; the system honours at most
 *   200 dp per edge, the web layer sends bands around the sticks).
 */
@CapacitorPlugin(name = "BlastyardSystem")
public class BlastyardSystemPlugin extends Plugin {
  @PluginMethod
  public void setKeepAwake(PluginCall call) {
    final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
    getActivity()
        .runOnUiThread(
            () -> {
              if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
              } else {
                getActivity()
                    .getWindow()
                    .clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
              }
              call.resolve();
            });
  }

  @PluginMethod
  public void setGestureExclusion(PluginCall call) {
    JSArray rects = call.getArray("rects", new JSArray());
    final float density = getActivity().getResources().getDisplayMetrics().density;
    final List<Rect> out = new ArrayList<>();
    for (int i = 0; i < rects.length(); i++) {
      JSONObject r = rects.optJSONObject(i);
      if (r == null) continue;
      int x = Math.round((float) r.optDouble("x", 0) * density);
      int y = Math.round((float) r.optDouble("y", 0) * density);
      int w = Math.round((float) r.optDouble("w", 0) * density);
      int h = Math.round((float) r.optDouble("h", 0) * density);
      if (w > 0 && h > 0) out.add(new Rect(x, y, x + w, y + h));
    }
    getActivity()
        .runOnUiThread(
            () -> {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                View view = getBridge().getWebView();
                if (view != null) view.setSystemGestureExclusionRects(out);
              }
              call.resolve();
            });
  }
}
