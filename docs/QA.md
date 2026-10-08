# QA & balance (T9.4)

Version 1.0.0, review of 2026-10-08. Automated parts are re-run before every release
(`docs/RELEASE.md` checklist); the device matrix is filled by hand on real hardware.

## Simulation stats
| Check | Command | Target | Result (2026-10-08) |
|---|---|---|---|
| Difficulty ladder | `npm run bot:league` (200 matches each) | Expert > Easy ≥ 90 %, Hard > Normal ≥ 70 % | Expert 92.0 % (184–16), Hard 76.5 % (153–47) ✅ |
| Own-pop deaths | same | Easy ≤ 35 %, Expert ≤ 10 % of deaths | Easy 27.7 % of 746, Expert 4.4 % of 341 ✅ |
| Round length | same, 4 × Normal | mean 60–150 s | 92.2 s (min 14.5, max 160.0; 8 draws in 200) ✅ |
| Match length | `npm run bot:league -- --match-length 40` | mean Classic match 6–12 min | 9.0 min (min 4.5, max 14.3), 5.9 rounds per match ✅ |
| Arenas | `npm run bot:league -- --arenas 100` | no undecided round, ≤ 15 % standoffs per arena | 0 undecided in 1200 rounds; 59 standoffs (4.9 %), highest Rink 13 %, Tunnel 10 %, Teleport garden 9 % ✅ |
| Simulation budget | `npm run sim:bench` | step ≤ 33 µs, 4 bots ≤ 300 µs, snapshot ≤ 4 KB | step 8.7 µs, 4 bots 99.7 µs, state 2451 B ✅ |
| Challenge solutions | `npm run validate:content` | all 36 + tutorial replay | ✅ |

## Review pass (automated coverage)
- **Gameplay:** deterministic core with golden hashes and replay tests; every challenge and the
  tutorial proven winnable by the bot solver; daily challenge proven winnable per day.
- **UX:** 82 regular e2e specs (start → every mode → result, party lobby, pause, back button,
  challenges, daily, tutorial, customize, purchases, settings persistence, gamepads).
- **Accessibility:** seats told apart by colour + shape + number; reduced motion (no shake /
  flash, fewer particles); larger text; left-handed and one-finger schemes; every menu screen
  checked in Hungarian (longest strings) at 667×375, 1280×720 and 2048×1536 for clipped text
  and off-screen buttons; no hard-coded UI strings (syntax-tree test).
- **Performance:** simulation within budget (above). The CI perf spec (≥ 55 FPS at 4× CPU
  throttle) cannot pass on headless SwiftShader (fill-rate bound, also red on `main`); the real
  measurement is the device matrix below.
- **Store / policy:** no reference-game trademark in the repository (unit test), privacy
  answers = site = iOS privacy manifest (unit tests), nothing in the party core gated (unit test).

## Fix list (triaged)
| Pri | Issue | Status |
|---|---|---|
| P0 | – | none open |
| P1 | – | none open |
| P2 | CI perf spec red under SwiftShader (environment, not the game) | owner decision: report-only in CI or GPU runner |
| P3 | Rink (13 %) and Tunnel (10 %) have the most standoffs with Normal bots; the closing spiral still ends every round | within the 15 % gate; watch in device play-tests |
| P3 | Store frame "chain" uses the arena dev view (no HUD) | acceptable; revisit with real device captures |
| P3 | Gamepad: no menu navigation with a controller, Start ≠ pause | later (HANDOFF) |

## Device matrix (owner)
Install the build (debug APK from Drive / `android-debug-latest`; iOS via TestFlight once the
release workflow has secrets) and fill one row per device. Pass = 4-corner party on one device
for 3 matches without missed touches, ≥ 55 FPS mean in a 4-bot match (Settings → touch test
for multi-touch), no system gesture stealing a control zone, audio and haptics OK, purchase
sandbox flow OK.

| Device | OS | Touches at once | Mean FPS (4 bots) | Edge gestures | Audio / haptics | IAP sandbox | Result |
|---|---|---|---|---|---|---|---|
| Reference low-end Android (e.g. Galaxy A1x / Moto G) | | | | | | | |
| Mid-range Android tablet | | | | | | | |
| iPhone (oldest supported, iOS 15+) | | | | | | | |
| iPad | | | | | | | |
