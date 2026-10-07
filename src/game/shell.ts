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
 *   `speed=70|85|100`  game speed for this session (default: settings)
 *   `motion=reduced|full`  reduced motion for this session (default: settings / OS)
 *
 * The shell also owns the game feel (T3.2/T3.3): settings, audio (unlocked by the first user
 * gesture), haptics, the frame pacer (60 FPS in a match, 30 in menus) and the automatic effect
 * quality drop when a match runs below 50 FPS for 3 s.
 */

import type { Application } from 'pixi.js';
import { GameAudio, type AudioStats } from '../audio';
import { CLASSIC_ARENAS } from '../content/arenas/classic';
import { Hdr, Phase, hashHex, stateHash, type ArenaDef } from '../core';
import type { ZoneSpec } from '../input/zones';
import { systemClock, type Clock } from '../platform/clock';
import { webHaptics, type HapticKind, type HapticsPort } from '../platform/haptics';
import { prefersReducedMotion } from '../platform/lifecycle';
import { webStore } from '../platform/storage';
import type { FxStats } from '../render/arenaView';
import type { FxSettings } from '../render/effects';
import type { ArenaLayout } from '../render/layout';
import { bakeArenaTextures, bakeControlTextures } from '../render/textures';
import {
  FramePacer,
  MATCH_FPS_CAP,
  MENU_FPS_CAP,
  QualityGovernor,
  type Quality,
} from './frameRate';

/** Highest renderer resolution per effect quality (0 = minimal … 2 = full). */
const QUALITY_RESOLUTION: Readonly<Record<Quality, number>> = { 0: 1, 1: 1.5, 2: Infinity };
import type { HudModel } from './hud';
import { MAX_CORNER_BOTS, type GameMode } from './modes';
import { GameSession, type MatchResult, type SessionFeel, type SessionSnapshot } from './session';
import {
  GAME_SPEEDS,
  SettingsStore,
  defaultSettings,
  hapticsEnabled,
  speedFactor,
  type GameSpeed,
  type Settings,
} from './settings';

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
  /** Session overrides (not saved). */
  readonly speed: GameSpeed | null;
  readonly reducedMotion: boolean | null;
  readonly clock?: Clock;
}

/** Injectable feel dependencies (tests); defaults are the web platform implementations. */
export interface ShellDeps {
  readonly settings?: SettingsStore;
  readonly audio?: GameAudio;
  readonly haptics?: HapticsPort;
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
  /** Effects on screen right now. */
  fx(): FxStats;
  audio(): AudioStats;
  settings(): Settings;
  setSettings(patch: Partial<Settings>): void;
  /** Effect quality (2 = full … 0 = minimal). */
  quality(): number;
  /** Measured match frame rate (latest window). */
  fps(): number;
  /** Real-time clock factor of the running session. */
  speed(): number;
  /** Frames drawn by the frame pacer so far (0 under a manual clock). */
  frames(): number;
  /** Mean main-thread time per frame (ms) since the current match started. */
  frameWorkMs(): number;
  /** Current renderer resolution (drops with the effect quality). */
  resolution(): number;
  /** Haptic pulses requested so far. */
  haptics(): HapticKind[];
  /** Starts a full-speed four-bot match on the playing screen (perf runs). */
  startBotMatch(): void;
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
    speed: GAME_SPEEDS.find((v) => String(v) === q.get('speed')) ?? null,
    reducedMotion: q.get('motion') === 'reduced' ? true : q.get('motion') === 'full' ? false : null,
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
  readonly settings: SettingsStore;
  readonly audio: GameAudio;
  private readonly haptics: HapticsPort;
  private readonly hapticLog: HapticKind[] = [];
  private readonly pacer = new FramePacer(MENU_FPS_CAP);
  private readonly governor: QualityGovernor;
  private frameCount = 0;
  private rafId = 0;
  /** Main-thread time spent in frames of the current match (perf measurements). */
  private workMs = 0;
  private workFrames = 0;
  private readonly baseResolution: number;

  constructor(
    private readonly app: Application,
    readonly options: ShellOptions,
    deps: ShellDeps = {},
  ) {
    this.arenaTex = bakeArenaTextures(app.renderer);
    this.controlTex = bakeControlTextures(app.renderer);
    this.baseResolution = app.renderer.resolution;
    this.clock = options.clock ?? systemClock;
    this.bots = options.bots;
    this.settings =
      deps.settings ?? new SettingsStore(webStore(), defaultSettings(prefersReducedMotion()));
    if (options.speed !== null) this.settings.override({ gameSpeed: options.speed });
    if (options.reducedMotion !== null) {
      this.settings.override({ reducedMotion: options.reducedMotion });
    }
    this.audio = deps.audio ?? new GameAudio();
    const port = deps.haptics ?? webHaptics;
    this.haptics = {
      pulse: (kind) => {
        if (options.test) this.hapticLog.push(kind);
        port.pulse(kind);
      },
    };
    this.governor = new QualityGovernor((q) => this.onQuality(q));
    const s = this.settings.get();
    this.audio.setVolumes(s.musicVolume, s.sfxVolume);
    this.audio.engine.attachUnlock();
    this.settings.subscribe((next) => this.applySettings(next));
    // Nothing moves on its own under a manual clock: no frame loop at all, sessions present
    // explicitly after every `advance` (keeps parallel e2e runs cheap and deterministic).
    // Otherwise the shell paces the Pixi ticker itself (frame cap per screen).
    app.ticker.autoStart = false;
    app.ticker.stop();
    if (!options.manualClock) this.startFrameLoop();
    this.attractSeed = options.seed ?? this.clock.now() | 0;
    this.showMenu();
    if (options.test) this.installTestHook();
  }

  /** Effect settings for new sessions. */
  private fxSettings(): FxSettings {
    return {
      reducedMotion: this.settings.get().reducedMotion,
      quality: this.governor.getQuality(),
    };
  }

  private applySettings(s: Settings): void {
    this.audio.setVolumes(s.musicVolume, s.sfxVolume);
    const session = this.session;
    if (!session) return;
    session.setFx(this.fxSettings());
    if (session.mode !== 'attract') {
      session.setSpeed(speedFactor(s.gameSpeed));
      session.setHaptics(hapticsEnabled(s.haptics, session.mode));
    }
  }

  private onQuality(q: Quality): void {
    this.session?.setFx(this.fxSettings());
    // Lower quality also renders fewer pixels: fill rate is what slow phones run out of first.
    const target = Math.min(this.baseResolution, QUALITY_RESOLUTION[q]);
    const r = this.app.renderer;
    if (r.resolution !== target) r.resize(this.app.screen.width, this.app.screen.height, target);
  }

  private startFrameLoop(): void {
    const raf = globalThis.requestAnimationFrame?.bind(globalThis);
    if (!raf) return;
    let last = -1;
    const loop = (now: number): void => {
      this.rafId = raf(loop);
      if (!this.pacer.accept(now)) return;
      if (last >= 0 && this.state.screen === 'playing') this.governor.frame(now - last);
      last = now;
      this.frameCount++;
      const t0 = performance.now();
      this.app.ticker.update(now);
      this.workMs += performance.now() - t0;
      this.workFrames++;
    };
    this.rafId = raf(loop);
  }

  /** Stops the frame loop and audio (page teardown, tests). */
  dispose(): void {
    if (this.rafId) globalThis.cancelAnimationFrame?.(this.rafId);
    this.rafId = 0;
    this.session?.destroy();
    this.session = null;
    this.audio.engine.dispose();
  }

  private sessionFeel(mode: GameMode): SessionFeel {
    const s = this.settings.get();
    return { audio: this.audio, haptics: this.haptics, hapticsOn: hapticsEnabled(s.haptics, mode) };
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
          fx: this.fxSettings(),
          speed: speedFactor(this.settings.get().gameSpeed),
          feel: this.sessionFeel(mode),
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onMatchOver: (result) => {
            this.session?.disableInput();
            this.toResult(result);
          },
        },
      ),
    );
    this.toPlaying();
  }

  /**
   * Four bots play a full match on the playing screen at full frame rate, with sound (perf
   * runs; a future "watch the bots" option).
   */
  startBotMatch(): void {
    const n = this.matches++;
    const seed = this.options.seed ?? (this.clock.now() ^ Math.imul(n + 1, 0x9e3779b9)) | 0;
    const arena = this.options.arena ?? (CLASSIC_ARENAS[n % CLASSIC_ARENAS.length] as ArenaDef);
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode: 'attract',
          seed,
          arena,
          winsToMatch: this.options.winsToMatch,
          manualClock: this.options.manualClock,
          fx: this.fxSettings(),
          feel: { audio: this.audio },
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onMatchOver: (result) => this.toResult(result),
        },
      ),
    );
    this.toPlaying();
  }

  private toPlaying(): void {
    this.pacer.setCap(MATCH_FPS_CAP);
    this.governor.reset();
    this.workMs = 0;
    this.workFrames = 0;
    this.set({ screen: 'playing', result: null });
  }

  private toResult(result: MatchResult): void {
    this.pacer.setCap(MENU_FPS_CAP);
    this.audio.menu();
    this.set({ screen: 'result', result });
  }

  /** Leaves the current match and shows the start screen over a bot match. */
  showMenu(): void {
    this.startAttract();
    this.pacer.setCap(MENU_FPS_CAP);
    this.audio.menu();
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
        {
          mode: 'attract',
          seed,
          arena,
          winsToMatch: 1,
          manualClock: this.options.manualClock,
          fx: this.fxSettings(),
        },
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
      fx: () => current().fxStats(),
      audio: () => this.audio.engine.stats(),
      settings: () => this.settings.get(),
      setSettings: (patch) => {
        this.settings.update(patch);
      },
      quality: () => this.governor.getQuality(),
      fps: () => this.governor.getFps(),
      speed: () => current().runner.loop.getSpeed(),
      frames: () => this.frameCount,
      frameWorkMs: () => (this.workFrames > 0 ? this.workMs / this.workFrames : 0),
      resolution: () => this.app.renderer.resolution,
      haptics: () => [...this.hapticLog],
      startBotMatch: () => this.startBotMatch(),
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
