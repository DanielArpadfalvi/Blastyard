/**
 * Game shell: owns the Pixi app's baked textures and the current {@link GameSession}, and is the
 * single object the Preact UI talks to (start a mode, leave to the menu, observe HUD snapshots
 * and match results).
 *
 * Behind the start screen four bots play an "attract" match. Query options (tests and dev):
 *   `test`             exposes `window.__blastyardGame` (see {@link GameTestHook})
 *   `clock=manual`     the simulation only advances through the hook (deterministic e2e)
 *   `seed=<int>`       fixed match seed (default: from the platform clock)
 *   `arena=<id>`       fixed classic arena (default: rotates)
 *   `wins=1–5`         rounds needed to win a match (default 3)
 *   `bots=0–3`         bot seats in the four-corner prototype (default 0)
 */

import type { Application } from 'pixi.js';
import { CLASSIC_ARENAS } from '../content/arenas/classic';
import { Hdr, Phase, hashHex, stateHash, type ArenaDef } from '../core';
import type { ZoneSpec } from '../input/zones';
import { systemClock, type Clock } from '../platform/clock';
import type { ArenaLayout } from '../render/layout';
import { bakeArenaTextures, bakeControlTextures } from '../render/textures';
import type { HudModel } from './hud';
import { MAX_CORNER_BOTS, type GameMode } from './modes';
import { GameSession, type MatchResult, type SessionSnapshot } from './session';

export type PlayMode = Exclude<GameMode, 'attract'>;
export type Screen = 'menu' | 'playing' | 'result';

export interface ShellState {
  readonly screen: Screen;
  readonly snapshot: SessionSnapshot | null;
  readonly result: MatchResult | null;
}

export interface ShellOptions {
  readonly test: boolean;
  readonly manualClock: boolean;
  readonly seed: number | null;
  readonly arena: ArenaDef | null;
  readonly winsToMatch: number;
  /** Default bot seats for the four-corner prototype. */
  readonly bots: number;
  readonly clock?: Clock;
}

/** `window.__blastyardGame` under `?test`. */
export interface GameTestHook {
  readonly ready: true;
  screen(): Screen;
  mode(): GameMode;
  tick(): number;
  phase(): number;
  round(): number;
  /** Pops on the field. */
  bombs(): number;
  hash(): string;
  /** Seat positions in tiles and liveness. */
  players(): Array<{ x: number; y: number; alive: boolean }>;
  hud(): HudModel;
  layout(): ArenaLayout;
  zones(): ZoneSpec[];
  /** Simulates `ticks` ticks of the current session (inputs sampled every tick). */
  advance(ticks: number): void;
  /**
   * Advances tick by tick until the phase is `phase` (and, for `MATCH_OVER`, the result screen is
   * due) or `maxTicks` ran out; returns the ticks simulated.
   */
  advanceUntilPhase(phase: number, maxTicks: number): number;
  /** Manual gesture clock for tap classification. */
  readonly pointerClock: { now: number };
}

declare global {
  interface Window {
    __blastyardGame?: GameTestHook;
  }
}

function intParam(q: URLSearchParams, name: string, min: number, max: number): number | null {
  const raw = q.get(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

export function parseShellOptions(search: string): ShellOptions {
  const q = new URLSearchParams(search);
  const test = q.has('test');
  const arenaId = q.get('arena');
  return {
    test,
    manualClock: test && q.get('clock') === 'manual',
    seed: intParam(q, 'seed', -0x80000000, 0x7fffffff),
    arena: CLASSIC_ARENAS.find((a) => a.id === arenaId) ?? null,
    winsToMatch: intParam(q, 'wins', 1, 5) ?? 3,
    bots: intParam(q, 'bots', 0, MAX_CORNER_BOTS) ?? 0,
  };
}

export class GameShell {
  private session: GameSession | null = null;
  private state: ShellState = { screen: 'menu', snapshot: null, result: null };
  private readonly listeners = new Set<(s: ShellState) => void>();
  private readonly arenaTex;
  private readonly controlTex;
  private matches = 0;
  private attractSeed = 0;
  private bots: number;
  private readonly clock: Clock;
  readonly pointerClock = { now: 0 };

  constructor(
    private readonly app: Application,
    readonly options: ShellOptions,
  ) {
    this.arenaTex = bakeArenaTextures(app.renderer);
    this.controlTex = bakeControlTextures(app.renderer);
    this.clock = options.clock ?? systemClock;
    this.bots = options.bots;
    // Nothing moves on its own under a manual clock: no frame loop at all, sessions present
    // explicitly after every `advance` (keeps parallel e2e runs cheap and deterministic).
    if (options.manualClock) app.ticker.stop();
    this.attractSeed = options.seed ?? this.clock.now() | 0;
    this.showMenu();
    if (options.test) this.installTestHook();
  }

  getState(): ShellState {
    return this.state;
  }

  subscribe(listener: (s: ShellState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts a match in `mode` (from the start or the result screen). `bots` (four-corner
   * prototype only) defaults to the last value used, initially the `bots` query option.
   */
  start(mode: PlayMode, bots = this.bots): void {
    this.bots = bots;
    const n = this.matches++;
    const seed = this.options.seed ?? (this.clock.now() ^ Math.imul(n + 1, 0x9e3779b9)) | 0;
    const arena = this.options.arena ?? (CLASSIC_ARENAS[n % CLASSIC_ARENAS.length] as ArenaDef);
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode,
          seed,
          arena,
          winsToMatch: this.options.winsToMatch,
          bots,
          manualClock: this.options.manualClock,
          ...(this.options.manualClock ? { pointerClock: () => this.pointerClock.now } : {}),
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onMatchOver: (result) => {
            this.session?.disableInput();
            this.set({ screen: 'result', result });
          },
        },
      ),
    );
    this.set({ screen: 'playing', result: null });
  }

  /** Leaves the current match and shows the start screen over a bot match. */
  showMenu(): void {
    this.startAttract();
    this.set({ screen: 'menu', snapshot: null, result: null });
  }

  private startAttract(): void {
    const seed = this.attractSeed++;
    const arena = this.options.arena ?? (CLASSIC_ARENAS[0] as ArenaDef);
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        { mode: 'attract', seed, arena, winsToMatch: 1, manualClock: this.options.manualClock },
        {
          // Keep the backdrop alive: a decided bot match is replaced by a fresh one.
          onMatchOver: () => {
            if (this.state.screen === 'menu') queueMicrotask(() => this.startAttract());
          },
        },
      ),
    );
  }

  private replaceSession(next: GameSession): void {
    this.session?.destroy();
    this.session = next;
  }

  private set(patch: Partial<ShellState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private installTestHook(): void {
    const current = (): GameSession => {
      if (!this.session) throw new Error('no session');
      return this.session;
    };
    window.__blastyardGame = {
      ready: true,
      pointerClock: this.pointerClock,
      screen: () => this.state.screen,
      mode: () => current().mode,
      tick: () => current().runner.state.hdr[Hdr.TICK] as number,
      phase: () => current().runner.state.hdr[Hdr.PHASE] as number,
      round: () => current().runner.state.hdr[Hdr.ROUND] as number,
      bombs: () => current().runner.state.hdr[Hdr.BOMB_COUNT] as number,
      hash: () => hashHex(stateHash(current().runner.state)),
      players: () => {
        const s = current().runner.state;
        return [0, 1, 2, 3].map((i) => ({
          x: (s.px[i] as number) / 256,
          y: (s.py[i] as number) / 256,
          alive: (s.alive[i] as number) !== 0,
        }));
      },
      hud: () => current().hud(),
      layout: () => current().getLayout(),
      zones: () => current().getZonePlan().zones,
      advance: (ticks) => current().advance(ticks),
      advanceUntilPhase: (phase, maxTicks) => {
        const session = current();
        return session.advanceWhile(
          () =>
            session.runner.state.hdr[Hdr.PHASE] !== phase ||
            (phase === Phase.MATCH_OVER && this.state.screen !== 'result'),
          maxTicks,
        );
      },
    };
  }
}
