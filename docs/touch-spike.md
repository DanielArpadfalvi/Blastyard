# T2.4 Device touch spike – owner checklist and results

Goal (PLAN §1.3, §1.4, §3.3, risk table): find out on real devices whether **4 fingers on one
screen** work, whether **system edge gestures** steal touches from the control zones, and whether
the **zone sizes** are comfortable (face-off ≈ 44 × 69 mm, four corners ≈ 44 × 34 mm on a phone,
≈ 45 × 60 mm on a tablet). Target: ≥ 1 iPhone, ≥ 1 mid-range Android, ≥ 1 tablet.

## 0. One-time setup (GitHub Pages)
1. GitHub → `DanielArpadfalvi/Blastyard` → **Settings → Pages → Build and deployment → Source:
   "GitHub Actions"**.
2. Push `main` (or Actions → **Pages** → *Run workflow*). When it is green the preview is at
   **https://danielarpadfalvi.github.io/Blastyard/**.
3. The preview build shows a **Device tests (preview)** row on the start screen: **Touch test**,
   **4 corners** and a **Bots: N** toggle (taps cycle 0–3 bot seats for the 4-corner game).
   Direct links: `…/Blastyard/?touchtest` (tester), `…/Blastyard/?spike&bots=2` (tools + 2 bots).
   Add `&lang=hu` / `&lang=en` to force the language.

Alternative without Pages: `npm run dev -- --host` on the PC and open `http://<PC-IP>:5173/?spike`
on the device (same Wi-Fi). Copy report may fall back to "select the text" over plain http.

## 1. Per device – what to try
Before you start: browser full screen if possible (Android Chrome: *Add to Home screen* gives a
nearly full-screen view; iOS Safari: *Share → Add to Home Screen*). If you test inside the normal
browser UI, write that in the notes (its bars cover part of the edges). **Rotation lock off, device in landscape.**

**A. Touch test** (`?touchtest`)
- [ ] Put down 1, 2, 3, 4, 5… fingers at once, spread over the screen. Note **Most at once**
      (pointer and touch-events number).
- [ ] With 4 fingers down, lift and re-place them a few times quickly – do dots vanish or
      "Cancelled touches" go up without a gesture?
- [ ] **Edge swipes:** from each edge (left, right, top, bottom) swipe inward, starting
      *outside* the dashed 8 mm frame, then once starting *on* the frame line. Note which ones open
      a system UI (back gesture, notification shade, control centre, home bar / app switcher) and
      how "Cancels by edge" changes.
- [ ] Hold 2 fingers in the left and right zones (where the thumbs go in face-off) and swipe from
      the bottom edge with a third finger – does it cancel the held fingers?
- [ ] **Palm rest:** rest the side of your hand on the screen edge as if holding the device flat on a
      table and reaching in; does it register as touches or cancel others?
- [ ] Tap **Copy report** and paste the text into the notes below (or the table).

**B. Face-off, 2 thumbs** (start screen → *Face-off*), device flat on a table, one player at each
short side (or you alone, one thumb per side)
- [ ] Both sticks + bomb buttons respond at the same time; no stuck stick after release.
- [ ] Zone size: comfortable / cramped / too big? Bomb button reachable without looking?
- [ ] Any accidental system gesture while playing a full round?

**C. 4 corners, 4 fingers** (start screen → *4 corners*, Bots: 0; with fewer people use Bots 1–3)
- [ ] Four fingers (four people, or two people with two fingers each) steer all four Puffs at once.
- [ ] Tap (short touch) drops a pop; a second finger in the zone while steering also drops one.
- [ ] Corner zone size verdict: OK / cramped / unusable. Do neighbouring hands collide?
- [ ] Fingers near the top/bottom long edges: notification shade / home bar triggered?
- [ ] HUD panels readable from each seat (top seats see their panel upside-down from your view).

**D. Rotation lock**
- [ ] With the OS rotation lock **on** and **off**: does the browser keep landscape when the device
      is laid flat? Does it flip during play when someone leans over? (The native app will lock
      orientation in matches; this tells us how bad the web preview is.)

## 2. Results

Edge-gesture conflicts: write the edge (L/R/T/B) and what happened, e.g. "B: home bar on swipe
from the bottom, cancels held thumbs" or "none". Zone verdict: OK / cramped / unusable for
face-off (FO) and corners (4C).

| Device (model, OS, browser) | Screen (from report) | Max touches (pointer / touch) | Edge-gesture conflicts | Zone-size verdict (FO / 4C) | Palm / rotation notes | Other notes |
| --------------------------- | -------------------- | ----------------------------- | ---------------------- | --------------------------- | --------------------- | ----------- |
| iPhone:                     |                      |                               |                        |                             |                       |             |
| Android (mid-range):        |                      |                               |                        |                             |                       |             |
| Tablet:                     |                      |                               |                        |                             |                       |             |
|                             |                      |                               |                        |                             |                       |             |

### Pasted reports
<!-- Paste the "Copy report" output per device here. -->

## 3. After the test (orchestrator)
- If any device reports < 4 touches: confirm the PLAN §1.3 warning ("this device only sees N
  fingers – try face-off") is required for T5.1.
- If edge gestures cancel touches inside the 8 mm margin: increase `ZONE_EDGE_MM`
  (`src/game/modes.ts`) and/or prioritise Android `setSystemGestureExclusionRects` / iOS
  `preferredScreenEdgesDeferringSystemGestures` in M7.
- If the 4-corner zones are cramped on phones: update PLAN §1.3/§1.5 (e.g. corners only
  recommended on tablets, bigger strips via `MIN_STRIP_MM`), then tick T2.4.

## 4. Gamepad spike (T5.5, desk research 2026-10-08)

Question: can the app read game controllers through the web Gamepad API inside the native
shells (Android System WebView, iOS WKWebView)?

**Verdict: viable on both platforms → implemented** (`src/input/gamepad.ts`, seat claims in the
lobby and in every mode). Findings:

- **Android (System WebView, Chromium):** `navigator.getGamepads()` is supported (MDN compat data
  lists WebView Android). Like Chrome, a controller only shows up after one of its buttons was
  pressed; that matches our claim-by-press flow. Needs a secure context: Capacitor serves the app
  from `https://localhost` (default `androidScheme: 'https'`), so this holds.
- **iOS (WKWebView):** supported since iOS 10.3 per MDN, but WebKit only exposes controllers to a
  WKWebView that is the **first responder** (WebKit team answer quoted in
  apache/cordova-ios#1397; Safari does this itself, embedding apps often do not, which explains
  the "empty array" reports, e.g. WebKit bugs 205448 / 269292). → **T7.1 requirement:** in the iOS
  shell, make the Capacitor `WKWebView` the first responder once it appears (custom
  `CAPBridgeViewController` subclass calling `webView?.becomeFirstResponder()` in
  `viewDidAppear`). The page is served from `capacitor://localhost`, a secure context.
- No plugin is needed; nothing in `src/platform` changes. Haptic rumble (`vibrationActuator`) is
  not used.

**Owner check on devices (with T7.3 builds):** pair an Xbox / PlayStation / MFi controller, open
Quick match, press A → the seat panel shows the controller badge; stick / D-pad steers, A pops.
Record the result per device:

| Device / OS | Controller | Detected after press? | Steers + pops? | Notes |
| ----------- | ---------- | --------------------- | -------------- | ----- |
| iPhone:     |            |                       |                |       |
| Android:    |            |                       |                |       |
| Tablet:     |            |                       |                |       |

Not done yet (later polish): menu navigation with a controller, Start = pause, rumble.
