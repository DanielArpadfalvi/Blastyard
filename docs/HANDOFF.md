# Handoff

Current state, next steps and local setup for the next session (human or agent). Updated after
every finished task (rule in `CLAUDE.md`).

## Last update: 2026-10-08 – M8 T8.1 purchases done; M9 T9.1 listing, T9.2 screenshots, T9.3 site done; APK → Google Drive

### Done in the latest session (branch `claude/relaxed-allen-18zaek`)
- **CI fixes** – the touch tester no longer renders the menu backdrop under itself
  (`GameShell.setCovered`); perf spec findings below.
- **APK → Google Drive** – `android.yml` runs on every push and overwrites
  `Blastyard-debug.apk` in the owner's Drive folder "Mobile games" (`scripts/drive-upload.mjs`,
  setup in `docs/RELEASE-drive.md`; needs the secret `GDRIVE_SERVICE_ACCOUNT_JSON`).
- **T8.1 purchases** – `src/platform/entitlement.ts` (port + mock store), `revenuecat.ts`
  (RevenueCat, no key ⇒ store unavailable), `store.ts` (which port; `?test`, `?store=`, `?plus`,
  `?supporter`); `src/ui/Paywall.tsx` (paywall, Supporter thanks, one-off card after the 5th
  match); custom rules (Blastyard+) `src/game/customRules.ts` + `src/ui/CustomRules.tsx`;
  Supporter items `goldcrown` + `confetti`. Owner setup: `docs/PURCHASES.md`.
- **T9.1 store listing** – `scripts/storeListing.ts` → `npm run listing` → `docs/store-listing.md`;
  `docs/store-privacy-answers.md`; trademark guard in `tests/unit/storeListing.test.ts`.
- **T9.2 store screenshots** – `npm run build && npm run store:frames` (50 framed PNGs,
  EN/HU × 5 sizes × 5 scenes, `--verify` for byte equality); manual workflow `store-frames.yml`.
- **Menu redesign** (owner request: the rounded pill boxes looked cheap) – `src/ui/styles.css`:
  design tokens in `:root` (`--ink`, `--panel`, `--accent`, `--teal`, `--chamfer`), cut-corner
  plates instead of pills, hazard stripe on every card, italic uppercase display type, flat
  segmented controls; start screen = Party hero tile + 3 mode tiles + secondary row
  (`.start-grid`, `src/ui/StartScreen.tsx`). All test ids unchanged; HU overflow checks green.
- **T9.3 site** – `scripts/site.ts` / `siteContent.ts` (`npm run site`), built by `pages.yml`
  into `/Blastyard/site/`; app links per language (`siteUrl`).
- Earlier in this branch: T5.3–T5.5, M6, M7 (see `docs/TASKS.md` "Done:" notes).

### State of the checks
- `npm run check`: green (533 unit tests, content validation incl. the tutorial's reference
  solution).
- e2e `landscape-chromium` locally: 82/82 green (incl. new `purchases.spec.ts`, paywall + custom
  rules in the HU overflow checks of `menus.spec.ts`).
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
- UI style: no rounded boxes (`--radius: 2px`); new components use `clip-path: var(--chamfer)` /
  `var(--chamfer-sm)` and `box-shadow: inset 0 0 0 1px var(--line)` for the hairline; primary
  action = `--accent` fill, secondary = `--panel-2` with a teal left bar.
- Purchases: the web has no store (paywall says "store unavailable") except the mock under
  `?test` / `?store=`. Natively RevenueCat with the public key from the build env; products are
  fetched directly (no offerings). A custom party setup without Plus plays Classic (kept, not
  deleted). Custom power-up frequencies also scale an arena's own weights (`customArena`). The
  Plus card is a once-only notice in `TipsStore` (`notices: ['plusHint']`).
- Drive upload: service account (key does not expire) updating a pre-created file (a service
  account has no storage of its own); the placeholder `Blastyard-debug.apk` exists in the folder.
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
- `android.yml` runs on every push (any branch, docs-only excepted) and overwrites
  `Blastyard-debug.apk` in the owner's Drive folder "Mobile games" (`scripts/drive-upload.mjs`).
- Not possible in this container (dl.google.com blocked, no macOS). Verify in GitHub Actions:
  `android.yml` can be started on any branch (workflow_dispatch); `ios.yml` runs on push when
  iOS inputs change (workflow_dispatch only works once the file is on main).
- After changing native code or Capacitor plugins: `npm run build && npx cap sync` locally
  (regenerates `capacitor.settings.gradle`, `CapApp-SPM/Package.swift`, `ios/app-id.xcconfig`).

### Open owner tasks
- Purchases: store products, RevenueCat project + entitlements, GitHub secrets
  `VITE_REVENUECAT_ANDROID_KEY` / `VITE_REVENUECAT_IOS_KEY` (`docs/PURCHASES.md`).
- Site: enable GitHub Pages (Settings → Pages → GitHub Actions), set the repository variable
  `SUPPORT_EMAIL`; review the listing texts (`docs/store-listing.md`) and privacy answers.
- Google Drive APK upload: set the `GDRIVE_SERVICE_ACCOUNT_JSON` secret (steps in
  `docs/RELEASE-drive.md`). Until then the Android workflow skips the upload with a warning.
- Decide how the CI perf spec should run (see above).
- T2.4 device touch spike (`docs/touch-spike.md` §1–3) and the gamepad device check (§4).
- T7.3: install the debug APK (artifact `blastyard-debug-apk`, or the `android-debug-latest`
  pre-release once on main) on a device for the touch re-check; try an iOS build on a Mac.

### Next step
- **M9 – T9.4** (QA & balance: bot-league + match-length sims, `docs/QA.md`; device checks
  are owner tasks) and T9.5 (versions aligned, hidden sourcemaps, iOS `PrivacyInfo.xcprivacy`,
  signed release workflows, `docs/RELEASE.md`).
- Gamepad polish (later): menu navigation with a controller, Start = pause.

## Local setup
- `npm ci`, then `npm run check` (≈ 1 min) before every commit; `npm run test:e2e` for UI changes.
- Chromium for Playwright is preinstalled at `/opt/pw-browsers`; never run `playwright install`.
- After any simulation change: bump `SIM_VERSION`, `npm run solve:challenges -- --write`,
  `npm run format` (regenerates the campaign and the tutorial solutions).
