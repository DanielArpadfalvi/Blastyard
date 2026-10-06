# Blastyard – contributor guide (for humans and agents)

Top-down, grid-based blast party game for 1–4 players on **one phone or tablet** (device laid flat, each player owns a control zone at the screen edge), plus bots, a challenge campaign and a daily challenge. Landscape only. Online private rooms with rollback netcode come in 1.1. Plan: `docs/PLAN.md` (Hungarian). Task list / status: `docs/TASKS.md`.

**Starting a new session? Read `docs/HANDOFF.md` first if it exists** (current state, next steps, local setup).

## Stack
Vite + TypeScript (strict) · PixiJS v8 (gameplay canvas) · Preact (DOM UI overlay) · Capacitor 8 (iOS/Android) · Vitest · Playwright.

## Architecture rules
- `src/core/` is pure, deterministic simulation: no DOM, no Pixi, no `Math.random`, no `Date.now`/`performance.now`, **integer-only state** (1 tile = 256 subunits, all timers in ticks). Fixed 60 Hz ticks. Seeded RNG streams (`src/core/rng.ts`) live inside the state.
- `step(state, inputs)` in `src/core/step.ts` is the only way to advance a match. It must stay pure and cheap: it is the future rollback-netcode primitive. Inputs are one byte per seat per tick (see PLAN §1.4). Never iterate `Map`/`Set` for order-dependent logic; order by seat index / creation order.
- State is struct-of-arrays in typed arrays with `snapshot()`/`restore()` and a state hash. Keep snapshots ≤ 4 KB and `step` within the `scripts/sim-bench` budget.
- Bots and challenge monsters run **inside** the simulation (`src/core/ai/`) with their own RNG stream, so replays (and later online matches) with bots are reproducible.
- `SIM_VERSION` must be bumped for any change that alters simulation results; update golden hashes and re-validate every built-in challenge solution in the same change.
- Every built-in challenge (`src/content/challenges/**`) carries a reference solution input log; `scripts/validate-content` replays all of them (and validates all arenas) in `npm run check`.
- `src/game/` owns the match lifecycle: lobby/seats, the fixed-tick accumulator loop, game-speed option (real-time clock only – never changes sim results), mode and objective logic. The real date (daily challenge) comes from `src/platform`, never from core.
- `src/render/` reads core state and draws it; it never mutates core state. Textures are generated once and pooled – no per-frame `Graphics` redraws. Per-seat HUD is rotated toward its seat.
- `src/input/` turns pointer/gamepad/keyboard events into per-seat input bytes: a touch belongs to the zone where it started until release; touches over the arena are ignored; stick vectors are rotated by the seat orientation.
- `src/platform/` wraps every native/Capacitor API (storage, haptics, IAP/RevenueCat, lifecycle, keep-awake, orientation lock, system-gesture exclusion, status bar, clock) behind an interface with a web/mock implementation. No other module imports `@capacitor/*` or RevenueCat directly.
- All user-visible strings go through `src/i18n/` (EN + HU).
- No external bitmap or audio assets: graphics (tiles, Puffs, pops, icon, splash, store frames) and audio are generated in code.
- No analytics, crash-reporting or ad SDKs (store privacy label: no tracking; only RevenueCat purchase history + anonymous app user ID, not linked to the user).
- Monetization: free download; the whole party game is free. Non-consumable `blastyard_plus` (extra arenas, challenge worlds 2–3, custom rules, cosmetics) and optional cosmetic `blastyard_supporter`. Never gate modes, player count, bot difficulty or power-ups. No ads, energy, currencies, consumables or loot boxes. Never use "Lite", "Demo" or "Trial" in app or store texts.
- Original IP only: never use the reference game's name, characters, bomb design or art – not in code, assets, store texts or keywords.

## Commands
- `npm run dev` – dev server
- `npm run check` – typecheck + lint + unit tests + content validation (must pass before every commit)
- `npm run test:e2e` – Playwright (Chromium at /opt/pw-browsers; never run `playwright install`)
- `npm run build` – production web build
- `npm run sim:bench` / `npm run bot:league` – simulation performance budget and bot win-rate targets

## Conventions
- Small focused modules, named exports, no default exports.
- Unit tests in `tests/unit/**`, e2e in `tests/e2e/**` (multi-pointer tests for table mode).
- Core logic changes need unit tests (scenario tests on tiny hand-built arenas are preferred). Bug fixes need a regression test.
- Native Android/iOS builds run only in GitHub Actions (dl.google.com is blocked in the cloud dev container).
- Bundle ID `com.arpadfalvi.blastyard` is defined in exactly one place.
