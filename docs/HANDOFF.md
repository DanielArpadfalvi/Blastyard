# Handoff

Current state, next steps and local setup for the next session (human or agent). Updated after
every finished task (rule in `CLAUDE.md`).

## Last update: 2026-10-08 – T5.5 gamepad done (M5 complete except the owner's device spike)

### Done in the latest session (branch `claude/relaxed-allen-18zaek`)
- **T5.3 daily challenge** – `src/game/daily.ts`, `dailyStore.ts`, `src/ui/DailyScreen.tsx`; the
  bot solver moved to `src/game/solver.ts` (shared with `scripts/solve-challenges.ts`).
- **T5.4 tutorial + first-time tips** – `src/content/tutorial.ts` (five-stage challenge level,
  new `chain` objective), `src/game/tips.ts`, `src/ui/Tutorial.tsx`.
- **T5.5 gamepad** – `src/input/gamepad.ts`, `webGamepads()` in `src/input/dom.ts`, controller
  badge in `src/ui/Hud.tsx`; spike notes in `docs/touch-spike.md` §4.
- Details per task: `docs/TASKS.md` (the "Done:" notes under each task).

### State of the checks
- `npm run check`: green (typecheck, lint, format, unit tests, content validation incl. the
  tutorial's reference solution).
- e2e: all new specs green (`daily`, `tutorial`, `gamepad`). Known red **in this cloud container
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
- Separate storage keys (`blastyard.challenges.v1`, `.daily.v1`, `.tips.v1`, `.party.v1`,
  `.settings.v1`) are to be folded into the versioned `save.v1` in T6.2.

### Open owner tasks
- T2.4 device touch spike (`docs/touch-spike.md` §1–3) and the gamepad device check (§4).

### Next step
- **M6 – T6.1 Menus & flow** (main menu with every mode incl. Daily / Tutorial, results, settings
  screen with all options listed in TASKS, Android back handling), then T6.2 save `save.v1`
  (migrate the separate keys above), T6.3 i18n lint.
- Gamepad polish for T6.1: menu navigation with a controller, Start = pause.

## Local setup
- `npm ci`, then `npm run check` (≈ 1 min) before every commit; `npm run test:e2e` for UI changes.
- Chromium for Playwright is preinstalled at `/opt/pw-browsers`; never run `playwright install`.
- After any simulation change: bump `SIM_VERSION`, `npm run solve:challenges -- --write`,
  `npm run format` (regenerates the campaign and the tutorial solutions).
