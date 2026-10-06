# Task list

Status: `[ ]` todo · `[~]` in progress · `[x]` done (verified by orchestrator). Acceptance criteria (AC) must all hold.
Numbers referenced below (tick rate, fuse, speeds, sizes) are defined in `docs/PLAN.md` §1.

## M0 – Foundation
- [ ] **T0.1 Scaffold** – Vite + TS strict, ESLint (flat config) + Prettier, Vitest, Playwright (Chromium from /opt/pw-browsers), PixiJS v8, Preact. Scripts per CLAUDE.md. Landscape, DPR-aware Pixi canvas filling the viewport + Preact overlay root; empty `src/{core,game,render,input,audio,ui,platform,i18n,content}`. ESLint rule forbidding `Math.random`, `Date.now`, `performance.now` and DOM/Pixi imports inside `src/core`. AC: `npm run check`, `npm run build`, `npm run test:e2e` (page loads, canvas exists, no console errors) pass; a deliberate `Math.random` in core fails lint.
- [ ] **T0.2 CI** – `.github/workflows/ci.yml`: node 22, npm ci, check, build, e2e. AC: valid YAML, mirrors local commands, green on a push.

## M1 – Core simulation (`src/core`)
- [ ] **T1.1 RNG + state model** – sfc32 with multiple named streams; struct-of-arrays state in typed arrays (grid, players, bombs, flames, pickups); `snapshot()/restore()`; FNV-1a state hash; `SIM_VERSION`. AC: unit tests; snapshot ≤ 4 KB for a 4-player state; restore→step gives identical hash to the uninterrupted run.
- [ ] **T1.2 Arena** – ASCII arena format, 13×13 grid, pillars, seeded crate fill (70%, spawn-safe L zones), hidden power-up placement (30%, weighted), arena validator (safe L per spawn, connected floor, spawn fairness). AC: 4 classic layouts load and validate; same seed ⇒ identical crate/pickup layout; validator rejects 3 crafted broken arenas.
- [ ] **T1.3 Movement** – subunit movement (1 tile = 256), base speed 16/tick, tile-axis turning, corner assist (≤ 96 subunits), collisions with walls/crates/bombs, owner may leave own bomb tile. AC: scenario tests on tiny arenas (corridor turns, assist window edges, bomb pass-through, blocked moves); no floats in state.
- [ ] **T1.4 Bombs & blasts** – placement (capacity, input buffer 6 ticks), 150-tick fuse, cross-shaped flames (range, stop at walls, destroy first crate), 4-tick chain delay, 30-tick lethal flame, pickup reveal/destruction, deaths. Extra Pop, Flame, Roller pickups. AC: scenario tests incl. multi-bomb chains, simultaneous deaths, flame vs. freshly revealed pickup grace.
- [ ] **T1.5 Round & match** – 180-tick countdown, 120 s timer, spiral sudden death (1 tile / 15 ticks, pause at 5×5), last survivor / draw, best-of 1/3/5, ghost revenge, 2v2 teams + friendly-fire flag, rule presets (Classic, Fast, Chaos); `step(state, inputs[4]) → events` with tick ids; input log (RLE) + replay. AC: golden hashes at ticks 1/600/end for 3 seeded scripted matches; replay of a recorded log reproduces the hash; event stream test for a full round.
- [ ] **T1.6 Sim bench** – `scripts/sim-bench` runs 1 000 seeded 4-player rounds with scripted random inputs headless. AC: reports mean `step` time and snapshot/restore time; budget (step ≤ 0.1 ms, snapshot+restore ≤ 0.05 ms on the CI runner) asserted with a 3× safety margin; no exceptions, no NaN.

## M2 – Playable prototype
- [ ] **T2.1 Renderer** – code-generated textures (tiles, pillars, crates, Puffs, pops with fuse ring, flames, pickups) baked once via `generateTexture`; sprite pools; tick interpolation; layout solver (arena square + side strips per PLAN §1.5). AC: screenshots at 2400×1080, 1600×720 and 2048×1536 show the full arena with ≥ 38 mm-equivalent strips; render never mutates core state (lint/test).
- [ ] **T2.2 Touch input** – zone manager (pointer bound to its start zone until release, 4 mm gutters, ignore arena touches), floating stick (12 dp dead zone, 15° hysteresis, secondary axis, 60 dp follow), bomb button (72/96 dp, press-edge), one-finger scheme (tap < 180 ms & < 12 dp, second finger = bomb), seat rotation 0/90/180/270, keyboard fallback. AC: unit tests for gesture classification and rotation mapping; Playwright multi-pointer test drives two zones simultaneously.
- [ ] **T2.3 First playable** – solo vs. a placeholder wander bot and 2-player face-off on one device; minimal HUD (timer, per-seat stats rotated toward the seat), round end → next round → match result. AC: e2e plays a scripted round to a result in both modes; screenshots reviewed.
- [ ] **T2.4 Device touch spike** – deploy a web preview (GitHub Pages or LAN dev server) with a multi-touch tester + 4-corner prototype; owner tests on ≥ 1 iPhone, ≥ 1 mid Android, ≥ 1 tablet. AC: `docs/touch-spike.md` records max simultaneous touches, edge-gesture conflicts and zone-size verdict per device; PLAN updated if the 4-corner layout needs changes.

## M3 – Game feel
- [ ] **T3.1 Effects** – explosion particles, crate debris, squash & stretch, blink/scared/victory animations, shake (≤ 6 px), flash, sudden-death wall drop; reduced-motion variant. AC: screenshot review; reduced motion disables shake/flash.
- [ ] **T3.2 Audio** – procedural SFX (fuse with final-0.5 s beeps, blast, pickup, death, sudden death), generative music (menu / match / sudden death +15% tempo), separate music/SFX volume. AC: no audio before first user gesture; unit test for sound event mapping; e2e no console errors.
- [ ] **T3.3 Feel & perf pass** – haptics via platform (default off in table mode), game speed 70/85/100% (render clock only), auto quality drop when FPS < 50 for 3 s, 60 FPS cap. AC: game-speed run produces the same hash as 100%; perf trace on a 4× CPU-throttled Chromium keeps ≥ 55 FPS mean in a 4-bot round.

## M4 – Content & bots
- [ ] **T4.1 All power-ups** – Kick (8 tiles/s slide), Toss (3 tiles over obstacles), Pierce, Shield (+60-tick invulnerability), Max Flame, Jinx (4 effects, 10 s, transferable on touch); Kick/Toss mutually exclusive; drop up to 4 pickups on death. AC: scenario test per power-up; weights match PLAN §1.2 over 10 000 seeded draws (±1.5 pp).
- [ ] **T4.2 Bot AI** – danger map with chain propagation, BFS escape, goal priorities, safe-placement check, 4 difficulties (PLAN §1.10 table), own RNG stream, inside `step`. `scripts/bot-league` runs seeded bot-vs-bot matches. AC (≥ 200 matches each): Expert beats Easy ≥ 90%, Hard beats Normal ≥ 70%; self-kill share Easy ≤ 35%, Expert ≤ 10%; 4× Normal mean round 60–150 s; 4 bots ≤ 0.3 ms/tick in sim-bench.
- [ ] **T4.3 Arenas** – 12 arenas (6 free incl. Ice Rink + Teleport Garden; 6 Plus: Conveyor Factory, Tunnel, Trampoline, Rubble, Maze, Mixed) with mechanics (ice slide ≤ 2 tiles, conveyors 8/tick, teleports, edge tunnels, bomb trampolines, growing pillars after 90 s), per-arena theme palette. AC: all pass the validator; mechanic scenario tests; bot-league per arena has no stalemate (>99% rounds end before the sudden-death 5×5 phase ends).
- [ ] **T4.4 Puffs & cosmetics** – 12 Puffs (8 free, 4 Plus) with distinct silhouettes, 4 seat colors + shape badge + number; 18 hats, 9 pop skins, 6 trails as code-defined data. AC: screenshot sheet of all items; every seat distinguishable in a grayscale screenshot.

## M5 – Modes
- [ ] **T5.1 Party & table mode** – seat setup 1–4 (human / bot difficulty / off), face-off and four-corner layouts, seat orientation arrows, warm-up lobby sandbox (no damage), hold-1-s ready, presets + 2v2, best-of, hold-0.6-s pause, auto-pause on background, Quick Match shortcut. AC: e2e with 4 simulated pointers joins, readies and finishes a round; per-seat HUD rotation verified by screenshot; touches starting over the arena are ignored (test).
- [ ] **T5.2 Challenges** – 36 levels (3 worlds × 12), objectives (crates, monsters, flag, survive, restricted win, collect), 1–3 stars, monsters (Snail, Hound, Hopper), world gauntlets, `scripts/validate-content` replays every built-in reference solution in `npm run check`. AC: all 36 solutions verify; star logic unit tests; world 2–3 lock respects entitlement (mock).
- [ ] **T5.3 Daily challenge** – date seed → arena variant + modifier + objective, local best and streak, one "official" attempt flag. AC: same date ⇒ same challenge (test); streak survives app restart; date taken via platform clock, never inside core.
- [ ] **T5.4 Tutorial** – 5 interactive steps (~90 s), skippable, contextual first-time tips (Kick, Jinx, sudden death). AC: e2e completes the tutorial with scripted inputs; tips show once (persisted).
- [ ] **T5.5 Gamepad & keyboard** – spike WKWebView/Android WebView Gamepad API; if viable, assign controllers to seats in the lobby. AC: spike result in `docs/touch-spike.md`; if viable, e2e with a mocked `navigator.getGamepads` plays a round; if not, task moved to M10 with reason.

## M6 – Meta & UI
- [ ] **T6.1 Menus & flow** – main menu (Party, Quick Match, Challenges, Daily, Tutorial, Customize, Settings), results screen (round/match, stats), pause, settings (language, volumes, haptics, game speed, control scheme, left-handed, zone size, corner-assist strength, friendly rule, reduced motion, larger text, touch test, about/privacy/restore/version), Android back handling. AC: e2e navigates every screen; menu usable at 1280×720 and 2048×1536 without clipping.
- [ ] **T6.2 Save & progression** – versioned `save.v1` via platform storage with migration hook, stats, 20 local trophies, milestone unlocks for cosmetics (no currency), customization screen. AC: unit tests for migrations and milestone unlocks; corrupt save falls back to defaults without crash.
- [ ] **T6.3 i18n & accessibility** – all strings EN + HU, color+shape+number seat identity, larger text, reduced motion, fuse audio cue. AC: lint/test fails on hard-coded UI strings; HU screenshots reviewed for overflow.

## M7 – Mobile shell
- [ ] **T7.1 Capacitor 8** – android/ios projects, bundle id `com.arpadfalvi.blastyard` (single source), landscape only, orientation lock during lobby/match, keep-awake during matches, safe areas, Android system-gesture exclusion rects, iOS deferred edge gestures, status bar hidden, lifecycle pause/resume, all behind `src/platform` with web mocks. AC: web mocks unit-tested; `npx cap sync` clean; no `@capacitor/*` import outside `src/platform`.
- [ ] **T7.2 Icon & splash from code** – `npm run assets` generates all icon/splash sizes from SVG. AC: generated files committed, iOS/Android asset catalogs complete.
- [ ] **T7.3 Native CI** – `android.yml` (APK/AAB artifact), `ios.yml` (macOS runner build), based on Swaplight workflows. AC: both workflows green; debug APK attached as artifact and installed on the owner's device for a touch re-check.

## M8 – Monetization
- [ ] **T8.1 Purchases** – platform interface + web mock + RevenueCat impl; `blastyard_plus` (entitlement `plus`: 6 arenas, worlds 2–3, custom rules, +4 Puffs/+6 hats/+3 skins) and `blastyard_supporter` (cosmetic); paywall (store price, buy, restore, pending/cancel/fail/success, Terms/Privacy), lock badges, single non-blocking hint card after the 5th finished match; native build without key ⇒ "store unavailable" (never unlocks). AC: unit tests for entitlement gating; e2e buys/restores via mock (`?test`); no party feature, player count, bot level or power-up is gated (test enumerates them).

## M9 – Release prep
- [ ] **T9.1 Store listing EN/HU** – title, subtitle, descriptions (first line states what is free), keywords without any trademarked game names, age-rating answers, `docs/store-privacy-answers.md` (no tracking; only RevenueCat purchase history + anonymous user ID, not linked — as in Craterpult). AC: owner-reviewable docs; grep finds no reference-game trademark in app, listing or keywords.
- [ ] **T9.2 Screenshot generator** – `scripts/store-frames.ts` renders deterministic scenes (4-corner party, explosion chain, challenge map, lobby, customization) at all required phone/tablet sizes with EN/HU captions. AC: images generated for every required size; reproducible byte-for-byte from seeds.
- [ ] **T9.3 Privacy & support site** – `docs/site/` (privacy policy, support/FAQ, terms link) for GitHub Pages, EN/HU. AC: links from settings and paywall resolve; policy matches the privacy answers.
- [ ] **T9.4 QA & balance** – full review pass (gameplay, UX, a11y, perf on reference low-end Android + iPhone + tablet), bot-league and match-length stats re-run, fix list triaged. AC: no open P0/P1; mean Classic match 6–12 min in sims; device matrix in `docs/QA.md`.
- [ ] **T9.5 Release 1.0.0** – versions aligned (package.json, Android, iOS), hidden sourcemaps, iOS PrivacyInfo, signed release workflows, `docs/RELEASE.md` + checklists. AC: tagged build artifacts ready for owner upload; owner tasks (store accounts, RevenueCat secrets, Pages enable, support mailbox) listed.

## M10 – 1.1 ideas (not in 1.0 scope)
- [ ] T10.1 Online private rooms – backend/signalling decision, WebRTC P2P, invite codes, input delay 2 + rollback ≤ 8 ticks on the existing deterministic core, desync detection via state hashes, bots fill seats
- [ ] T10.2 Pass-and-play tournament (same seeded challenge, best score wins)
- [ ] T10.3 Level editor + offline share codes (solution-verified like built-in challenges)
- [ ] T10.4 New modes (King of the Hill, Gold Rush) and 6-player 15×15 arenas for tablets
- [ ] T10.5 More languages (DE, ES, PT-BR), TV/casting-friendly view
