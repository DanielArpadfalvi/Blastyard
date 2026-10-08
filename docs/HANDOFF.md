# Handoff

Current state, next steps and local setup for the next session (human or agent). Updated after
every finished task (rule in `CLAUDE.md`).

## Last update: 2026-10-08 – M7 done (T7.3 waits on the owner's device check); CI e2e investigated

### Done in the latest session (branch `claude/relaxed-allen-18zaek`)
- **T5.3 daily challenge** – `src/game/daily.ts`, `dailyStore.ts`, `src/ui/DailyScreen.tsx`; the
  bot solver moved to `src/game/solver.ts` (shared with `scripts/solve-challenges.ts`).
- **T5.4 tutorial + first-time tips** – `src/content/tutorial.ts` (five-stage challenge level,
  new `chain` objective), `src/game/tips.ts`, `src/ui/Tutorial.tsx`.
- **T5.5 gamepad** – `src/input/gamepad.ts`, `webGamepads()` in `src/input/dom.ts`, controller
  badge in `src/ui/Hud.tsx`; spike notes in `docs/touch-spike.md` §4.
- **T6.1 menus & flow** – settings sections (`src/ui/SettingsPanel.tsx`, `src/game/settings.ts`),
  friendly rule + corner-assist strength as core rule flags (defaults unchanged, no `SIM_VERSION`
  bump), control prefs (`touchParamsFor`, `zonesForPlan(…, prefs)`), result stats table,
  back handling (`src/platform/back.ts` + `goBack` in `src/ui/App.tsx`), `@capacitor/app`
  dependency (the Android CI's `cap sync` registers it; `cap update` fails locally without
  built assets – harmless).
- **T6.2 save & progression** – `src/game/save.ts` (one versioned document `blastyard.save`,
  migration hook, corrupt / newer-version handling), `stats.ts`, `unlocks.ts`, `looks.ts`,
  `src/content/trophies.ts` (20), `src/ui/Customize.tsx` (looks per seat + trophies & stats).
- **T6.3 i18n & accessibility** – `tests/unit/i18nStrings.test.ts` (no hard-coded UI strings,
  placeholder parity), HU overflow checks at 667×375 / 1280×720 / 2048×1536 in
  `tests/e2e/menus.spec.ts`, small-phone CSS (scrolling cards, compact start card).
- **T7.1 Capacitor shell** – `src/platform/system.ts` (keep-awake, orientation lock, gesture
  exclusion; shell enables it for lobby + matches), own native plugin
  (`android/app/src/main/java/app/blastyard/BlastyardSystemPlugin.java`,
  `ios/App/App/BlastyardSystemPlugin.swift`), iOS project (SPM) with `BlastyardViewController`,
  bundle id only in `capacitor.config.ts` (Gradle reads the synced config; iOS via
  `ios/app-id.xcconfig` from `scripts/native-config.ts`, run by the `capacitor:sync:after` hook).
- **T7.2 assets** – `scripts/brand.ts` (SVG art) + `npm run assets` (headless Chromium renders all
  Android / iOS / web icons and splashes; committed).
- **T7.3 native CI** – `android.yml` (debug APK + unsigned AAB; pre-release only from main),
  `ios.yml` (macOS: simulator + unsigned device build; also on `claude/**` when iOS inputs change).
- Details per task: `docs/TASKS.md` (the "Done:" notes under each task).

### State of the checks
- `npm run check`: green (typecheck, lint, format, unit tests, content validation incl. the
  tutorial's reference solution).
- CI (`ci.yml`) e2e runs in two steps: the `landscape-chromium` project (all regular specs,
  green), then the real-time render specs (`heavy` project: feel, spike, render) and `perf` on
  one worker.
- The 2048×1536 touch tester (`spike.spec.ts`) timed out on CI because the attract match kept
  rendering under the opaque tester (software WebGL). Fixed: `GameShell.setCovered()` skips
  frames while the tester is open (App effect); e2e "the menu backdrop is not drawn behind the
  opaque touch tester". Locally the test now takes 6.5 s (it timed out before, on main too).
- **Known red, pre-existing on main:** `perf.spec.ts` (≥ 55 FPS mean at 4× throttle). Headless
  SwiftShader is fill-rate bound: CI measured 30 FPS on main and 14.5 on the branch, and locally
  base and branch both measure ≈ 3.8 FPS with the same main-thread cost (≈ 8.7–8.9 ms/frame), so
  no regression on the branch. The threshold is not lowered: the T3.3 device measurement on a
  real mid-range phone is the real check (open question for the owner: make the perf spec
  report-only in CI, or run it on a GPU runner).

### Decisions worth knowing
- Daily challenge: proven winnable in the browser by the Expert bot (first qualifying seed); the
  pick is cached per day and `SIM_VERSION` in `blastyard.daily.v1`. Official = first started
  attempt of the day; streak = consecutive days won.
- Tutorial: a lost step restarts at that step; Skip counts as done; tips (`kick`, `jinx`,
  `suddenDeath`) show once, 3 s, persisted in `blastyard.tips.v1`.
- Gamepads: a press claims the first free human seat; claims survive across matches; a pad is a
  relative device (rotated by seat orientation); holding a pop button = lobby ready hold.
- Persistence: everything goes through `SaveStore` (shell constructor). A new persisted part =
  a new entry key inside the document (no new localStorage key). A format change of an existing
  part = bump `SAVE_VERSION` and add a `MIGRATIONS` step + unit test.
- Trophies are computed from progress, never stored; milestone unlocks likewise.
- Friendly rule / corner assist never apply to challenges, daily or tutorial (their reference
  solutions run on the default rules).

### Native builds
- Not possible in this container (dl.google.com blocked, no macOS). Verify in GitHub Actions:
  `android.yml` can be started on any branch (workflow_dispatch); `ios.yml` runs on push when
  iOS inputs change (workflow_dispatch only works once the file is on main).
- After changing native code or Capacitor plugins: `npm run build && npx cap sync` locally
  (regenerates `capacitor.settings.gradle`, `CapApp-SPM/Package.swift`, `ios/app-id.xcconfig`).

### Open owner tasks
- Decide how the CI perf spec should run (see above).
- T2.4 device touch spike (`docs/touch-spike.md` §1–3) and the gamepad device check (§4).
- T7.3: install the debug APK (artifact `blastyard-debug-apk`, or the `android-debug-latest`
  pre-release once on main) on a device for the touch re-check; try an iOS build on a Mac.

### Next step
- **M8 – T8.1 Purchases**: RevenueCat implementation behind `src/platform/entitlement.ts`
  (interface already has `hasPlus`, `subscribe`, `restore`; add products / buy / pending states),
  paywall UI, single hint card after the 5th finished match, `?test` mock purchase flow, test that
  no party feature / player count / bot level / power-up is gated. RevenueCat keys are owner
  secrets; without a key the native build shows "store unavailable" (never unlocks).
- Then M9 release prep (store texts, screenshot generator, privacy site, QA, release workflow).
- Gamepad polish (later): menu navigation with a controller, Start = pause.

## Local setup
- `npm ci`, then `npm run check` (≈ 1 min) before every commit; `npm run test:e2e` for UI changes.
- Chromium for Playwright is preinstalled at `/opt/pw-browsers`; never run `playwright install`.
- After any simulation change: bump `SIM_VERSION`, `npm run solve:challenges -- --write`,
  `npm run format` (regenerates the campaign and the tutorial solutions).
