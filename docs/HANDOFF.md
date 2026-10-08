# Handoff

Current state, next steps and local setup for the next session (human or agent). Updated after
every finished task (rule in `CLAUDE.md`).

## Last update: 2026-10-08 – T6.2 save & progression done (T6.1 complete with it)

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
- Details per task: `docs/TASKS.md` (the "Done:" notes under each task).

### State of the checks
- `npm run check`: green (typecheck, lint, format, unit tests, content validation incl. the
  tutorial's reference solution).
- e2e: all new specs green (`daily`, `tutorial`, `gamepad`, `menus`, `customize`). Known red **in this cloud container
  only**, also without these changes: `feel.spec.ts` (5 tests) and the 2048×1536 touch tester in
  `spike.spec.ts` time out (slow software WebGL; CI gives 120 s). `render.spec.ts` 2048×1536 can
  time out when the whole suite runs in parallel; alone it passes.

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

### Open owner tasks
- T2.4 device touch spike (`docs/touch-spike.md` §1–3) and the gamepad device check (§4).

### Next step
- **T6.3 i18n & accessibility**: a lint/unit test that fails on hard-coded user-visible strings in
  `src/ui/**` (JSX text and `aria-label` / `title` / `alt` literals; allow symbols / numbers),
  check that `en` and `hu` have identical key sets (likely already tested in
  `tests/unit/i18n.test.ts`), HU screenshots for overflow, fuse audio cue check, colour + shape +
  number seat identity (exists).
- Then M7 (T7.1 Capacitor shell incl. the iOS first-responder note, T7.2 icons from code, T7.3
  native CI) and M8 purchases.
- Gamepad polish (later): menu navigation with a controller, Start = pause.

## Local setup
- `npm ci`, then `npm run check` (≈ 1 min) before every commit; `npm run test:e2e` for UI changes.
- Chromium for Playwright is preinstalled at `/opt/pw-browsers`; never run `playwright install`.
- After any simulation change: bump `SIM_VERSION`, `npm run solve:challenges -- --write`,
  `npm run format` (regenerates the campaign and the tutorial solutions).
