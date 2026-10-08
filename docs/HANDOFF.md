# Handoff

Current state, next steps and local setup for the next session (human or agent).

## State (2026-10-08)
- Done: M0–M4, T5.1 party & table mode, T5.2 challenge campaign (36 levels), T5.3 daily challenge.
- Open owner task: T2.4 device touch spike (needs real devices; `docs/touch-spike.md`).
- Next in order: T5.4 tutorial, T5.5 gamepad spike, then M6 (menus, save `save.v1`, i18n lint).

## Daily challenge notes (T5.3)
- `src/game/daily.ts` generates a day's challenge from its day number and proves it winnable with
  the bot solver (`src/game/solver.ts`, shared with `scripts/solve-challenges.ts`). The search runs
  in the browser the first time a day is opened (usually < 0.5 s, worst seen ≈ 2 s; it yields
  between seed tries) and the pick is remembered in `blastyard.daily.v1`.
- A simulation change (`SIM_VERSION` bump) can change which day gets which seed; remembered picks
  are keyed by `SIM_VERSION`, so they are recomputed. Official results and streaks are kept.
- The daily store has its own key until `save.v1` (T6.2) folds it in; streak milestones (PLAN
  §1.9) should read `bestStreak` from it.

## Local setup
- `npm ci`, then `npm run check` (≈ 1 min) before every commit; `npm run test:e2e` for UI changes.
- Chromium for Playwright is preinstalled at `/opt/pw-browsers`; never run `playwright install`.
