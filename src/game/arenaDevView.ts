/**
 * Dev / test arena view (T2.1): `?test` (without `game`) or `?view=arena` runs a match with idle or scripted
 * inputs and draws it, so the renderer can be looked at and e2e-tested before the real game flow
 * exists. Query parameters:
 *
 *   arena=garden|crossroads|courtyard|bastions   seed=<int>   seats=1–4
 *   script=demo|idle   pause (start paused)   tick=<n> (fast-forward)   speed=0.25–2
 *   scene=chain|suddenDeath (showcase set-up, see `showcase.ts`)
 *   motion=reduced (no shake / flash)   quality=0–2 (effect quality, default 2)
 *
 * Under `?test` only, `window.__blastyard` exposes a small test hook (see {@link ArenaTestHook}).
 */

import type { Application } from 'pixi.js';
import {
  CELL_COUNT,
  GRID_W,
  Hdr,
  MAX_SEATS,
  Tile,
  createState,
  hashHex,
  stateHash,
  type ArenaDef,
} from '../core';
import { CLASSIC_ARENAS } from '../content/arenas/classic';
import { ArenaView, type FxStats, type RenderStats } from '../render/arenaView';
import type { EffectQuality, FxSettings } from '../render/effects';
import { solveLayout, type ArenaLayout } from '../render/layout';
import { readSafeInsets } from '../render/safeArea';
import { bakeArenaTextures } from '../render/textures';
import { demoInput } from './demoScript';
import { MatchRunner, idleInputs, type InputProvider } from './matchRunner';
import { applyShowcase, parseShowcase, type ShowcaseId } from './showcase';

export interface ArenaViewOptions {
  readonly arena: ArenaDef;
  readonly seed: number;
  readonly seats: number;
  readonly script: 'demo' | 'idle';
  readonly paused: boolean;
  readonly startTick: number;
  readonly speed: number;
  readonly testHook: boolean;
  readonly scene: ShowcaseId | null;
  readonly fx: FxSettings;
}

/** What the state itself says should be visible (compared against `RenderStats` in e2e). */
export interface StateCounts {
  readonly crates: number;
  readonly pillars: number;
  readonly blocks: number;
  readonly pickups: number;
  readonly flames: number;
  readonly pops: number;
  readonly puffs: number;
  readonly ghosts: number;
}

/** `window.__blastyard` under `?test`. */
export interface ArenaTestHook {
  readonly ready: true;
  tick(): number;
  phase(): number;
  hash(): string;
  /** Pauses and simulates `ticks` ticks immediately, then redraws. */
  advance(ticks: number): void;
  pause(): void;
  resume(): void;
  layout(): ArenaLayout;
  renderStats(): RenderStats;
  stateCounts(): StateCounts;
  /** Effects on screen right now. */
  fx(): FxStats;
}

declare global {
  interface Window {
    __blastyard?: ArenaTestHook;
  }
}

/** True when the query asks for the arena dev / test view. */
export function wantsArenaView(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get('view') === 'arena' || (q.has('test') && !q.has('input') && !q.has('game'));
}

function intParam(q: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const raw = q.get(name);
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function parseArenaViewOptions(search: string): ArenaViewOptions {
  const q = new URLSearchParams(search);
  const arenaId = q.get('arena') ?? 'garden';
  const arena = CLASSIC_ARENAS.find((a) => a.id === arenaId) ?? (CLASSIC_ARENAS[0] as ArenaDef);
  const speed = Number.parseFloat(q.get('speed') ?? '1');
  return {
    arena,
    seed: intParam(q, 'seed', 1, -0x80000000, 0x7fffffff),
    seats: intParam(q, 'seats', MAX_SEATS, 1, MAX_SEATS),
    script: q.get('script') === 'idle' ? 'idle' : 'demo',
    paused: q.has('pause'),
    startTick: intParam(q, 'tick', 0, 0, 100_000),
    speed: Number.isFinite(speed) ? speed : 1,
    testHook: q.has('test'),
    scene: parseShowcase(q.get('scene')),
    fx: {
      reducedMotion: q.get('motion') === 'reduced',
      quality: intParam(q, 'quality', 2, 0, 2) as EffectQuality,
    },
  };
}

export function countStateVisibles(runner: MatchRunner): StateCounts {
  const s = runner.state;
  let crates = 0;
  let pillars = 0;
  let blocks = 0;
  let pickups = 0;
  let flames = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const x = c % GRID_W;
    const y = (c - x) / GRID_W;
    const interior = x > 0 && y > 0 && x < GRID_W - 1 && y < GRID_W - 1;
    const tile = s.tiles[c] as number;
    if (interior && tile === Tile.CRATE) crates++;
    else if (interior && tile === Tile.PILLAR) pillars++;
    else if (interior && tile === Tile.WALL) blocks++;
    else if (tile === Tile.FLOOR && (s.pickup[c] as number) !== 0) pickups++;
    if ((s.flame[c] as number) > 0) flames++;
  }
  let puffs = 0;
  let ghosts = 0;
  for (let seat = 0; seat < MAX_SEATS; seat++) {
    if (((s.hdr[Hdr.SEAT_MASK] as number) & (1 << seat)) === 0) continue;
    if (s.alive[seat]) puffs++;
    else if (s.ghost[seat]) ghosts++;
  }
  const pops = s.hdr[Hdr.BOMB_COUNT] as number;
  return { crates, pillars, blocks, pickups, flames, pops, puffs, ghosts };
}

/** Starts the arena view on `app`'s stage. Returns the runner (the loop runs on the app ticker). */
export function startArenaView(app: Application, search: string): MatchRunner {
  const opts = parseArenaViewOptions(search);
  const state = createState({
    seed: opts.seed,
    arena: opts.arena,
    seats: Array.from({ length: MAX_SEATS }, (_, s) => s < opts.seats),
  });
  if (opts.scene) applyShowcase(state, opts.scene);
  const textures = bakeArenaTextures(app.renderer);
  const view = new ArenaView(textures, opts.fx);
  app.stage.addChild(view.root);
  const provider: InputProvider =
    opts.script === 'demo' && opts.scene === null
      ? (st, out) => {
          for (let s = 0; s < MAX_SEATS; s++) out[s] = demoInput(st, s);
        }
      : idleInputs;
  const runner = new MatchRunner(state, provider, view, opts.speed);
  runner.onEvents((events) => view.pushEvents(events, state));

  let layout = solveLayout({ width: app.screen.width, height: app.screen.height });
  let lastKey = '';
  const relayout = (): void => {
    const safe = readSafeInsets();
    const key = `${app.screen.width}x${app.screen.height}:${safe.top},${safe.right},${safe.bottom},${safe.left}`;
    if (key === lastKey) return;
    lastKey = key;
    layout = solveLayout({ width: app.screen.width, height: app.screen.height, safe });
    view.setLayout(layout);
  };
  relayout();

  runner.advance(opts.startTick);
  runner.setPaused(opts.paused);
  app.ticker.add((ticker) => {
    relayout();
    runner.frame(ticker.deltaMS);
  });

  if (opts.testHook) {
    window.__blastyard = {
      ready: true,
      tick: () => state.hdr[Hdr.TICK] as number,
      phase: () => state.hdr[Hdr.PHASE] as number,
      hash: () => hashHex(stateHash(state)),
      advance: (ticks) => {
        runner.setPaused(true);
        runner.advance(ticks);
      },
      pause: () => runner.setPaused(true),
      resume: () => runner.setPaused(false),
      layout: () => layout,
      renderStats: () => view.getStats(),
      stateCounts: () => countStateVisibles(runner),
      fx: () => view.getFxStats(),
    };
  }
  return runner;
}
