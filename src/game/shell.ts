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
 *   `plus` / `supporter`  pretend Blastyard+ / the Supporter pack is owned (web mock store)
 *   `store=mock|none|pending|cancelled|failed`  web mock store (default: `mock` with `test`,
 *                      else `none`); natively RevenueCat (T8.1)
 *   `date=YYYY-MM-DD`  the daily challenge of that date instead of today's (T5.3)
 *
 * The shell also owns the game feel (T3.2/T3.3): settings, audio (unlocked by the first user
 * gesture), haptics, the frame pacer (60 FPS in a match, 30 in menus) and the automatic effect
 * quality drop when a match runs below 50 FPS for 3 s.
 */

import { Container, Sprite, type Application } from 'pixi.js';
import { GameAudio, type AudioStats } from '../audio';
import { FREE_ARENAS, arenaById } from '../content/arenas';
import { levelById, nextLevel, tuningOf } from '../content/challenges';
import { TUTORIAL, TUTORIAL_ID } from '../content/tutorial';
import {
  BotLevel,
  Hdr,
  Phase,
  hashHex,
  rleEncode,
  rleLength,
  stateHash,
  type ArenaDef,
  type Rules,
} from '../core';
import { webGamepads } from '../input/dom';
import { GamepadSeats } from '../input/gamepad';
import type { SeatOrientation } from '../input/rotation';
import type { ZoneSpec } from '../input/zones';
import {
  localDate,
  parseDate,
  systemClock,
  type CalendarDate,
  type Clock,
} from '../platform/clock';
import { deviceLanguage, setLanguage } from '../i18n';
import type { Entitlements, MockEntitlements, MockOutcome } from '../platform/entitlement';
import { parseStoreChoice, platformEntitlements, type StoreChoice } from '../platform/store';
import { onAppVisibility } from '../platform/lifecycle';
import { platformBack, type BackPort } from '../platform/back';
import { platformSystem, type SystemPort, type SystemState } from '../platform/system';
import { webHaptics, type HapticKind, type HapticsPort } from '../platform/haptics';
import { prefersReducedMotion } from '../platform/lifecycle';
import { webStore, type KeyValueStore } from '../platform/storage';
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
import type { StageDef } from './challenge';
import { ChallengeProgress } from './progress';
import { SaveStore } from './save';
import { StatsStore, type LifetimeStats } from './stats';
import { LooksStore, wornLook } from './looks';
import type { ProgressContext } from './unlocks';
import type { TrophyContext } from '../content/trophies';
import { hatIndex, popSkinIndex, puffIndex, type Appearance } from '../content/cosmetics';
import { dayNumber, prepareDailyAsync, type DailyChallenge } from './daily';
import { DailyStore, betterRecord, type DailyView } from './dailyStore';
import { botPlay } from './solver';
import { TIP_IDS, TipsStore, type TipId } from './tips';
import type { HudModel } from './hud';
import { gestureBands, type ControlPrefs } from './modes';
import type { LobbySeatView } from './lobby';
import { MAX_CORNER_BOTS, type GameMode } from './modes';
import { DEFAULT_PARTY, partyArena, pickArena, resolveParty, type PartyConfig } from './party';
import { PartyStore, type StoredParty } from './partyStore';
import {
  GameSession,
  type ChallengeResult,
  type MatchResult,
  type SessionFeel,
  type SessionSnapshot,
} from './session';
import {
  GAME_SPEEDS,
  SettingsStore,
  defaultSettings,
  hapticsEnabled,
  speedFactor,
  type GameSpeed,
  type Settings,
} from './settings';

export type PlayMode = Exclude<GameMode, 'attract' | 'party' | 'challenge'>;
/**
 * `lobby`: the party's warm-up arena; `challengeResult`: a challenge was won or lost;
 * `tutorialDone`: the last tutorial step was won.
 */
export type Screen = 'menu' | 'lobby' | 'playing' | 'result' | 'challengeResult' | 'tutorialDone';

export interface ShellState {
  readonly screen: Screen;
  readonly snapshot: SessionSnapshot | null;
  readonly result: MatchResult | null;
  readonly challengeResult: ChallengeResult | null;
  /** A first-time tip to show right now (T5.4). */
  readonly tip: TipId | null;
  /** Tutorial: index of the step being retried after a lost attempt (null = none). */
  readonly tutorialRetry: number | null;
  /** Show the one-off Blastyard+ card under this result (T8.1). */
  readonly plusHint?: boolean;
}

/** The Blastyard+ card shows once, after this many finished matches (PLAN §2). */
export const PLUS_HINT_AFTER = 5;

/** What "play again" repeats. */
type LastStart =
  | { readonly kind: 'mode'; readonly mode: PlayMode }
  | { readonly kind: 'party'; readonly config: PartyConfig }
  | { readonly kind: 'quick' }
  | { readonly kind: 'challenge'; readonly id: string }
  | { readonly kind: 'daily' }
  | { readonly kind: 'tutorial' };

export interface ShellOptions {
  readonly test: boolean;
  readonly manualClock: boolean;
  readonly seed: number | null;
  readonly arena: ArenaDef | null;
  readonly winsToMatch: number;
  /** Default bot seats for the four-corner prototype. */
  readonly bots: number;
  /** Mock Blastyard+ entitlement (`?plus`). */
  readonly plus: boolean;
  /** Mock Supporter entitlement (`?supporter`). */
  readonly supporter?: boolean;
  /** Web mock store (`?store=`). */
  readonly store?: StoreChoice | null;
  /** Session overrides (not saved). */
  readonly speed: GameSpeed | null;
  readonly reducedMotion: boolean | null;
  /** Daily challenge date override (`?date`). */
  readonly date: CalendarDate | null;
  /** `?lang=en|hu` was given: it wins over the language setting for this session. */
  readonly langForced?: boolean;
  readonly clock?: Clock;
}

/** Injectable feel dependencies (tests); defaults are the web platform implementations. */
export interface ShellDeps {
  readonly settings?: SettingsStore;
  readonly entitlements?: Entitlements;
  readonly progress?: ChallengeProgress;
  readonly daily?: DailyStore;
  readonly tips?: TipsStore;
  readonly gamepads?: GamepadSeats;
  readonly back?: BackPort;
  readonly system?: SystemPort & { state(): SystemState };
  readonly save?: KeyValueStore;
  readonly stats?: StatsStore;
  readonly looks?: LooksStore;
  readonly partyStore?: PartyStore;
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
  /** Lobby: join / ready state of every human seat (null outside the lobby). */
  lobby(): readonly LobbySeatView[] | null;
  /** Seat orientations of the running session. */
  orientations(): number[];
  /** Is the running match paused? */
  paused(): boolean;
  /** Pauses / resumes the running match. */
  setPaused(paused: boolean): void;
  /** Mock store: own Blastyard+ (or not). */
  setPlus(plus: boolean): void;
  /** Mock store: own the Supporter pack (or not). */
  setSupporter(on: boolean): void;
  /** Mock store: what the next purchases do. */
  setStoreOutcome(outcome: MockOutcome): void;
  /** Mock store: the pending payments go through. */
  completePending(): void;
  hasSupporter(): boolean;
  hasPlus(): boolean;
  /** Id of the arena the running session plays on. */
  arena(): string;
  /** Starts challenge level `id` directly (as the map's Play button does). */
  startChallenge(id: string): void;
  /** Daily challenge: prepares today's (or `?date`'s) challenge; resolves with its outline. */
  prepareDaily(): Promise<{ levelId: string; objective: string; modifier: string; seed: number }>;
  /** Starts an attempt at the prepared daily challenge. */
  startDaily(): void;
  /** The bot's winning input log (RLE) of the prepared daily challenge (scripted e2e play). */
  dailySolution(): number[];
  /** Today's daily progress: official attempt, best, streak. */
  dailyView(): DailyView;
  /** System back action (Android back button): true when the game used it. */
  back(): boolean;
  /** What each seat wears in new sessions (after milestone / Plus checks). */
  wornLooks(): Appearance[];
  /** Lifetime stats. */
  stats(): LifetimeStats;
  /** What the device layer was last told: keep awake, orientation lock, gesture bands. */
  system(): SystemState;
  /** Seats a game controller currently steers. */
  gamepadSeats(): number[];
  /** Tutorial: starts it (at step `stage`, 0-based). */
  startTutorial(stage?: number): void;
  /** Tutorial done flag and the first-time tips already shown. */
  tips(): { tutorialDone: boolean; shown: string[] };
  /** The tip on screen right now. */
  tip(): string | null;
  /** Records a best-stars result (to unlock the following levels in tests). */
  recordStars(id: string, stars: number): void;
  /** Challenge: objective progress and status of the running challenge (null otherwise). */
  challenge(): {
    levelId: string;
    done: number;
    target: number;
    status: string;
    stage: number;
  } | null;
  /**
   * Challenge / scripted play: feeds seat 0 the packed input log (RLE `[byte, count, …]`, one
   * byte per tick) instead of the touch zones.
   */
  playScript(log: number[]): void;
  /** Advances until the challenge result screen is due (or `maxTicks`); returns ticks run. */
  advanceUntilChallengeOver(maxTicks: number): number;
  /** Advances until the lobby hands over to the match (or `maxTicks`); returns ticks run. */
  advanceUntilLobbyDone(maxTicks: number): number;
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
    arena: arenaById(arenaId) ?? null,
    plus: q.has('plus'),
    supporter: q.has('supporter'),
    store: parseStoreChoice(q.get('store')),
    winsToMatch: intParam(q, 'wins', 1, 5) ?? 3,
    bots: intParam(q, 'bots', 0, MAX_CORNER_BOTS) ?? 0,
    speed: GAME_SPEEDS.find((v) => String(v) === q.get('speed')) ?? null,
    reducedMotion: q.get('motion') === 'reduced' ? true : q.get('motion') === 'full' ? false : null,
    date: parseDate(q.get('date')),
    langForced: q.get('lang') === 'en' || q.get('lang') === 'hu',
  };
}

export class GameShell {
  private session: GameSession | null = null;
  private state: ShellState = {
    screen: 'menu',
    snapshot: null,
    result: null,
    challengeResult: null,
    tip: null,
    tutorialRetry: null,
  };
  private readonly listeners = new Set<(s: ShellState) => void>();
  private readonly arenaTex;
  private readonly controlTex;
  private matches = 0;
  private attractSeed = 0;
  private bots: number;
  private last: LastStart | null = null;
  readonly entitlements: Entitlements;
  readonly progress: ChallengeProgress;
  readonly daily: DailyStore;
  readonly tips: TipsStore;
  /** The save document every store reads and writes through (T6.2). */
  readonly save: KeyValueStore;
  readonly stats: StatsStore;
  readonly looks: LooksStore;
  private readonly thumbs = new Map<string, Promise<string>>();
  /** Game controllers; their seat claims last across matches (T5.5). */
  readonly gamepads: GamepadSeats;
  /** System back action (Android back button; Escape on desktop) – the UI installs the handler. */
  readonly back: BackPort;
  /** Keep-awake, orientation lock and gesture exclusion while a lobby / match is up (T7.1). */
  private readonly system: SystemPort & { state(): SystemState };
  private dailyCache: { day: number; promise: Promise<DailyChallenge> } | null = null;
  private dailyReady: DailyChallenge | null = null;
  private readonly partyStore: PartyStore;
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
  /** An opaque full-screen panel (touch tester) hides the canvas: no frames are drawn. */
  private covered = false;
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
    this.entitlements =
      deps.entitlements ??
      platformEntitlements({
        test: options.test,
        plus: options.plus,
        supporter: options.supporter ?? false,
        store: options.store ?? null,
      });
    // One versioned save document for every persisted part (T6.2).
    const save = deps.save ?? new SaveStore(webStore());
    this.save = save;
    this.progress = deps.progress ?? new ChallengeProgress(save);
    this.daily = deps.daily ?? new DailyStore(save);
    this.tips = deps.tips ?? new TipsStore(save);
    this.stats = deps.stats ?? new StatsStore(save);
    this.looks = deps.looks ?? new LooksStore(save);
    this.gamepads = deps.gamepads ?? new GamepadSeats(webGamepads());
    this.back = deps.back ?? platformBack();
    this.system = deps.system ?? platformSystem();
    this.partyStore = deps.partyStore ?? new PartyStore(save);
    this.settings =
      deps.settings ?? new SettingsStore(save, defaultSettings(prefersReducedMotion()));
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
    this.applyPresentation(s);
    this.lastLanguage = s.language;
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
    // Going to the background pauses a running match (PLAN §1.3).
    onAppVisibility((visible) => {
      if (!visible) this.pauseIfPlaying();
    });
    if (options.test) this.installTestHook();
  }

  /** The saved party setup and the Quick Match bot level. */
  getParty(): StoredParty {
    return this.partyStore.get();
  }

  /** Saves the party setup (the party screen calls this on every change). */
  setParty(next: StoredParty): void {
    this.partyStore.set(next);
  }

  /** Does the player own Blastyard+ (mock until M8)? */
  /** The web mock store, when this build uses it (test hook). */
  private mockStore(): MockEntitlements | null {
    const e = this.entitlements as Partial<MockEntitlements>;
    return typeof e.setOutcome === 'function' ? (e as MockEntitlements) : null;
  }

  hasPlus(): boolean {
    return this.entitlements.hasPlus();
  }

  /** Effect settings for new sessions. */
  private fxSettings(): FxSettings {
    return {
      reducedMotion: this.settings.get().reducedMotion,
      quality: this.governor.getQuality(),
    };
  }

  /** Language and larger text (T6.1); a `?lang` query keeps its language for the session. */
  private applyPresentation(s: Settings): void {
    if (!this.options.langForced || this.langTouched) {
      setLanguage(s.language === 'auto' ? deviceLanguage() : s.language);
    }
    globalThis.document?.documentElement.classList.toggle('large-text', s.largeText);
  }

  /** The language setting was changed in this session (it then wins over `?lang`). */
  private langTouched = false;
  private lastLanguage: Settings['language'] | null = null;

  /** Milestone / trophy inputs: lifetime stats, stars, best daily streak, Blastyard+. */
  progressContext(): ProgressContext {
    return {
      stats: this.stats.get(),
      stars: this.progress.totalStars(),
      bestStreak: this.daily.view(this.today()).bestStreak,
      hasPlus: this.hasPlus(),
      hasSupporter: this.entitlements.hasSupporter(),
    };
  }

  trophyContext(): TrophyContext {
    return {
      ...this.progressContext(),
      starsOf: (id) => this.progress.starsOf(id),
      tutorialDone: this.tips.tutorialDone,
    };
  }

  /** What every seat wears in new sessions (locked items fall back to the seat default). */
  private wornLooks(): Appearance[] {
    const ctx = this.progressContext();
    return this.looks.all().map((look, seat) => wornLook(look, seat, ctx));
  }

  /**
   * A cosmetic item drawn as a PNG data URL for the Customize screen (baked once from the same
   * textures the arena uses, then cached).
   */
  thumbnail(kind: 'puff' | 'hat' | 'pop', id: string, seat: number): Promise<string> {
    const key = kind === 'pop' ? `pop:${id}` : `${kind}:${id}:${seat}:${this.looks.get(seat).puff}`;
    let found = this.thumbs.get(key);
    if (!found) {
      let target: Container;
      if (kind === 'hat') {
        // A hat alone is a small shape at the top of its canvas: show it on the seat's Puff.
        target = new Container();
        const look = this.looks.get(seat);
        target.addChild(new Sprite(this.arenaTex.puffOf(puffIndex(look.puff), seat)));
        target.addChild(new Sprite(this.arenaTex.hatOf(Math.max(0, hatIndex(id)))));
      } else {
        target = new Sprite(
          kind === 'puff'
            ? this.arenaTex.puffOf(puffIndex(id), seat)
            : this.arenaTex.popOf(popSkinIndex(id)),
        );
      }
      found = this.app.renderer.extract.base64({ target });
      this.thumbs.set(key, found);
    }
    return found;
  }

  /** Touch control preferences for new sessions. */
  private controlPrefs(): ControlPrefs {
    const s = this.settings.get();
    return { scheme: s.scheme, leftHanded: s.leftHanded, zoneScale: s.zoneScale };
  }

  /** Rule options for party, Quick Match and the first-playable modes (never challenges). */
  private ruleTweaks(): Pick<Rules, 'selfDamage' | 'cornerAssist'> {
    const s = this.settings.get();
    return { selfDamage: !s.friendly, cornerAssist: s.cornerAssist };
  }

  private applySettings(s: Settings): void {
    if (this.lastLanguage !== null && s.language !== this.lastLanguage) this.langTouched = true;
    this.lastLanguage = s.language;
    this.applyPresentation(s);
    this.audio.setVolumes(s.musicVolume, s.sfxVolume);
    const session = this.session;
    if (!session) return;
    session.setFx(this.fxSettings());
    if (session.mode !== 'attract') {
      session.setSpeed(speedFactor(s.gameSpeed));
      const humans = session.plan.filter((p) => p.kind === 'human').length;
      session.setHaptics(hapticsEnabled(s.haptics, session.mode, humans));
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
      if (this.covered || !this.pacer.accept(now)) return;
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

  /**
   * An opaque panel covers the whole canvas (the touch tester): skip drawing behind it, which
   * keeps its touch handling responsive on big screens. Only for menus – never during a match.
   */
  setCovered(on: boolean): void {
    this.covered = on && this.state.screen === 'menu';
  }

  /** Stops the frame loop and audio (page teardown, tests). */
  dispose(): void {
    if (this.rafId) globalThis.cancelAnimationFrame?.(this.rafId);
    this.rafId = 0;
    this.session?.destroy();
    this.session = null;
    this.audio.engine.dispose();
  }

  private sessionFeel(mode: GameMode, humans?: number): SessionFeel {
    const s = this.settings.get();
    return {
      audio: this.audio,
      haptics: this.haptics,
      hapticsOn: hapticsEnabled(s.haptics, mode, humans),
    };
  }

  /** Seed of the next match: fixed by `?seed`, else from the platform clock. */
  private nextSeed(): number {
    const n = this.matches++;
    return this.options.seed ?? (this.clock.now() ^ Math.imul(n + 1, 0x9e3779b9)) | 0;
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
    this.last = { kind: 'mode', mode };
    const n = this.matches++;
    const seed = this.options.seed ?? (this.clock.now() ^ Math.imul(n + 1, 0x9e3779b9)) | 0;
    const arena = this.options.arena ?? (FREE_ARENAS[n % FREE_ARENAS.length] as ArenaDef);
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
          gamepads: this.gamepads,
          controls: this.controlPrefs(),
          ruleTweaks: this.ruleTweaks(),
          looks: this.wornLooks(),
        },
        this.matchCallbacks(),
      ),
    );
    this.toPlaying();
  }

  private commonOptions(): {
    manualClock: boolean;
    pointerClock?: () => number;
    fx: FxSettings;
    speed: number;
    gamepads: GamepadSeats;
    controls: ControlPrefs;
    looks: Appearance[];
  } {
    return {
      looks: this.wornLooks(),
      gamepads: this.gamepads,
      controls: this.controlPrefs(),
      manualClock: this.options.manualClock,
      ...(this.options.manualClock ? { pointerClock: () => this.pointerClock.now } : {}),
      fx: this.fxSettings(),
      speed: speedFactor(this.settings.get().gameSpeed),
    };
  }

  private matchCallbacks(): {
    onSnapshot: (snapshot: SessionSnapshot) => void;
    onMatchOver: (result: MatchResult) => void;
    onTip: (tip: TipId) => void;
  } {
    return {
      onSnapshot: (snapshot) => this.set({ snapshot }),
      onTip: this.onTip,
      onMatchOver: (result) => {
        this.session?.disableInput();
        const arena = this.session?.options.arena.id;
        if (arena) this.stats.recordMatch(result, arena);
        this.toResult(result);
      },
    };
  }

  /**
   * Party (T5.1): shows the warm-up lobby for `config` – a sandbox arena where every seat joins
   * by touching its zone, can move and bomb without damage, and gets ready by resting a finger
   * for a second. When everybody is ready the match starts with the (possibly turned) seats.
   */
  startLobby(config: PartyConfig): void {
    this.last = { kind: 'party', config };
    const seed = this.nextSeed();
    const arena = partyArena(
      this.options.arena ?? pickArena(config, this.hasPlus(), seed),
      config,
      this.hasPlus(),
    );
    const party = resolveParty(config, this.hasPlus());
    const humans = party.seats.filter((p) => p.kind === 'human').length;
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode: 'party',
          ruleTweaks: this.ruleTweaks(),
          seed,
          arena,
          winsToMatch: party.rules.winsToMatch,
          party,
          lobby: true,
          ...this.commonOptions(),
          feel: this.sessionFeel('party', humans),
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onLobbyDone: (orientations) => {
            // Carry the seats' turned orientations into the match, then start it (same seed
            // and arena: the lobby showed the very field).
            const turned = config.orientations.map((_, i) =>
              party.layout === 'solo' ? null : (orientations[i] as SeatOrientation),
            );
            queueMicrotask(() =>
              this.startPartyMatch({ ...config, orientations: turned }, seed, arena),
            );
          },
        },
      ),
    );
    this.pacer.setCap(MATCH_FPS_CAP);
    this.set({ screen: 'lobby', result: null, challengeResult: null });
  }

  /** Starts the party match itself (after the lobby, or straight from Quick Match / replay). */
  startPartyMatch(
    config: PartyConfig,
    seed = this.nextSeed(),
    // Already custom-weighted when it comes from the lobby.
    arena = partyArena(
      this.options.arena ?? pickArena(config, this.hasPlus(), seed),
      config,
      this.hasPlus(),
    ),
  ): void {
    this.last = { kind: 'party', config };
    const party = resolveParty(config, this.hasPlus());
    const humans = party.seats.filter((p) => p.kind === 'human').length;
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode: 'party',
          ruleTweaks: this.ruleTweaks(),
          seed,
          arena,
          winsToMatch: party.rules.winsToMatch,
          party,
          ...this.commonOptions(),
          feel: this.sessionFeel('party', humans),
        },
        this.matchCallbacks(),
      ),
    );
    this.toPlaying();
  }

  /** Quick Match: you against three bots of the saved level, Classic rules, one tap. */
  startQuick(): void {
    const { quickLevel } = this.getParty();
    const bot = { kind: 'bot' as const, level: quickLevel };
    const config: PartyConfig = {
      ...DEFAULT_PARTY,
      seats: [{ kind: 'human', level: BotLevel.NORMAL }, bot, bot, bot],
      winsToMatch: 3,
    };
    this.startPartyMatch(config);
    this.last = { kind: 'quick' };
  }

  /** Starts challenge level `id` (must be unlocked; a locked level is ignored). */
  startChallenge(id: string): void {
    const level = levelById(id);
    if (!level || this.progress.lockOf(level, this.hasPlus()) !== 'open') return;
    this.last = { kind: 'challenge', id };
    const tuning = tuningOf(id);
    const seed = tuning.seeds[0] ?? 1;
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode: 'challenge',
          seed,
          arena: (level.stages[0] as StageDef).arena,
          winsToMatch: 1,
          challenge: { level, tuning },
          ...this.commonOptions(),
          feel: this.sessionFeel('challenge'),
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onTip: this.onTip,
          onChallengeOver: (result) => {
            this.session?.disableInput();
            if (result.won) {
              this.progress.record(result.level.id, result.stars);
              this.stats.recordChallengeWin();
            }
            this.pacer.setCap(MENU_FPS_CAP);
            this.audio.menu();
            this.set({ screen: 'challengeResult', challengeResult: result });
          },
        },
      ),
    );
    this.toPlaying();
  }

  /** Today's day number (platform clock, or the `?date` override). */
  today(): number {
    return dayNumber(this.options.date ?? localDate(this.clock));
  }

  /**
   * Today's daily challenge, proven winnable (the bot search runs once per day and its result is
   * remembered across restarts).
   */
  prepareDaily(): Promise<DailyChallenge> {
    const day = this.today();
    if (this.dailyCache?.day === day) return this.dailyCache.promise;
    const promise = prepareDailyAsync(day, this.daily.pickFor(day)).then(({ challenge, pick }) => {
      if (this.daily.pickFor(day) === null) this.daily.rememberPick(day, pick);
      this.dailyReady = challenge;
      return challenge;
    });
    this.dailyCache = { day, promise };
    return promise;
  }

  /** Today's daily challenge if {@link prepareDaily} has finished. */
  preparedDaily(): DailyChallenge | null {
    const ready = this.dailyReady;
    return ready && ready.day === this.today() ? ready : null;
  }

  /** Starts an attempt at today's daily challenge (it must be prepared). */
  startDaily(): void {
    const daily = this.preparedDaily();
    if (!daily) return;
    this.last = { kind: 'daily' };
    const day = daily.day;
    const official = this.daily.beginAttempt(day);
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode: 'challenge',
          seed: daily.tuning.seeds[0] ?? 1,
          arena: (daily.level.stages[0] as StageDef).arena,
          winsToMatch: 1,
          challenge: { level: daily.level, tuning: daily.tuning },
          ...this.commonOptions(),
          feel: this.sessionFeel('challenge'),
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onTip: this.onTip,
          onChallengeOver: (result) => {
            this.session?.disableInput();
            const record = { won: result.won, stars: result.stars, ticks: result.stats.ticks };
            const newBest = betterRecord(record, this.daily.view(day).best) && result.won;
            this.daily.finish(day, official, record);
            if (result.won) this.stats.recordDailyWin();
            this.pacer.setCap(MENU_FPS_CAP);
            this.audio.menu();
            this.set({
              screen: 'challengeResult',
              challengeResult: {
                ...result,
                daily: { day, official, newBest, view: this.daily.view(day) },
              },
            });
          },
        },
      ),
    );
    this.toPlaying();
  }

  /** Shows a first-time tip unless it was shown before (persisted). */
  private readonly onTip = (tip: TipId): void => {
    if (this.tips.take(tip)) this.set({ tip });
  };

  /** Hides the tip on screen (after its 3 s). */
  clearTip(): void {
    if (this.state.tip !== null) this.set({ tip: null });
  }

  /**
   * The tutorial (T5.4): five steps played as one five-stage challenge. A lost step starts over
   * at that step (`fromStage`); winning the last one marks the tutorial done.
   */
  startTutorial(fromStage = 0, retry = false): void {
    this.last = { kind: 'tutorial' };
    const tuning = tuningOf(TUTORIAL_ID);
    const stage = Math.max(0, Math.min(TUTORIAL.stages.length - 1, fromStage));
    this.replaceSession(
      new GameSession(
        this.app,
        this.arenaTex,
        this.controlTex,
        {
          mode: 'challenge',
          seed: tuning.seeds[stage] ?? 1,
          arena: (TUTORIAL.stages[stage] as StageDef).arena,
          winsToMatch: 1,
          challenge: { level: TUTORIAL, tuning, startStage: stage },
          ...this.commonOptions(),
          feel: this.sessionFeel('challenge'),
        },
        {
          onSnapshot: (snapshot) => this.set({ snapshot }),
          onTip: this.onTip,
          onChallengeOver: (result) => {
            this.session?.disableInput();
            if (!result.won) {
              queueMicrotask(() => this.startTutorial(result.stage, true));
              return;
            }
            this.tips.setTutorialDone();
            this.pacer.setCap(MENU_FPS_CAP);
            this.audio.menu();
            this.set({ screen: 'tutorialDone', challengeResult: null });
          },
        },
      ),
    );
    this.toPlaying();
    if (retry) this.set({ tutorialRetry: stage });
  }

  /** Skips the rest of the tutorial (it counts as done) and goes back to the menu. */
  skipTutorial(): void {
    this.tips.setTutorialDone();
    this.showMenu();
  }

  /** The level after the one just played, if it can be played. */
  nextChallengeId(): string | null {
    const current = this.last?.kind === 'challenge' ? this.last.id : null;
    const next = current ? nextLevel(current) : undefined;
    return next && this.progress.lockOf(next, this.hasPlus()) === 'open' ? next.id : null;
  }

  /** Plays the next challenge level. */
  startNextChallenge(): void {
    const id = this.nextChallengeId();
    if (id) this.startChallenge(id);
  }

  /** Repeats the last thing that was started (play again / retry). */
  again(): void {
    const last = this.last;
    if (!last) return;
    switch (last.kind) {
      case 'mode':
        this.start(last.mode);
        break;
      case 'party':
        this.startPartyMatch(last.config);
        break;
      case 'quick':
        this.startQuick();
        break;
      case 'challenge':
        this.startChallenge(last.id);
        break;
      case 'daily':
        this.startDaily();
        break;
      case 'tutorial':
        this.startTutorial();
        break;
    }
  }

  /** Lobby: turns a seat's orientation (the arrow in its zone). */
  turnSeat(seat: number): void {
    this.session?.turnSeat(seat);
  }

  /** Lobby: everybody ready at once (accessibility / desktop). */
  readyAll(): void {
    this.session?.readyAll();
  }

  /** Pauses / resumes the running match. */
  setPaused(paused: boolean): void {
    const screen = this.state.screen;
    if (!this.session || (screen !== 'playing' && screen !== 'lobby')) return;
    if (this.session.mode === 'attract') return;
    this.session.setPaused(paused);
  }

  /** Background: pause a match in progress (not the lobby, which has no clock to lose). */
  pauseIfPlaying(): void {
    if (this.state.screen === 'playing') this.setPaused(true);
  }

  /**
   * Four bots play a full match on the playing screen at full frame rate, with sound (perf
   * runs; a future "watch the bots" option).
   */
  startBotMatch(): void {
    const n = this.matches++;
    const seed = this.options.seed ?? (this.clock.now() ^ Math.imul(n + 1, 0x9e3779b9)) | 0;
    const arena = this.options.arena ?? (FREE_ARENAS[n % FREE_ARENAS.length] as ArenaDef);
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
    this.set({
      screen: 'playing',
      result: null,
      challengeResult: null,
      tip: null,
      tutorialRetry: null,
      plusHint: false,
    });
  }

  private toResult(result: MatchResult): void {
    this.pacer.setCap(MENU_FPS_CAP);
    this.audio.menu();
    const plusHint =
      !this.hasPlus() &&
      this.stats.get().matches >= PLUS_HINT_AFTER &&
      this.tips.takeNotice('plusHint');
    this.set({ screen: 'result', result, plusHint });
  }

  /** Leaves the current match and shows the start screen over a bot match. */
  showMenu(): void {
    this.startAttract();
    this.pacer.setCap(MENU_FPS_CAP);
    this.audio.menu();
    this.set({ screen: 'menu', snapshot: null, result: null, challengeResult: null });
  }

  private startAttract(): void {
    const seed = this.attractSeed++;
    const arena = this.options.arena ?? (FREE_ARENAS[0] as ArenaDef);
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
          looks: this.wornLooks(),
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

  private inPlay(): boolean {
    return this.state.screen === 'playing' || this.state.screen === 'lobby';
  }

  /** Lobby and matches keep the screen on and the orientation fixed; menus release both. */
  private syncSystem(): void {
    const active = this.inPlay();
    this.system.keepAwake(active);
    this.system.lockOrientation(active);
    if (!active) {
      this.system.excludeGestures([]);
    } else if (this.state.snapshot) this.syncGestures(this.state.snapshot);
  }

  private syncGestures(snapshot: SessionSnapshot): void {
    const rects = gestureBands(snapshot.zones);
    this.system.excludeGestures(rects);
  }

  private replaceSession(next: GameSession): void {
    this.session?.destroy();
    this.session = next;
  }

  private set(patch: Partial<ShellState>): void {
    const before = this.state.screen;
    this.state = { ...this.state, ...patch };
    if (patch.screen !== undefined && patch.screen !== before) this.syncSystem();
    if (patch.snapshot && this.inPlay()) this.syncGestures(patch.snapshot);
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
      lobby: () => this.state.snapshot?.lobby ?? null,
      orientations: () => current().plan.map((p) => p.orientation),
      paused: () => this.session?.paused ?? false,
      setPaused: (paused) => this.setPaused(paused),
      setPlus: (plus) => this.mockStore()?.setPlus(plus),
      setSupporter: (on) => this.mockStore()?.setSupporter(on),
      setStoreOutcome: (outcome) => this.mockStore()?.setOutcome(outcome),
      completePending: () => this.mockStore()?.completePending(),
      hasSupporter: () => this.entitlements.hasSupporter(),
      hasPlus: () => this.hasPlus(),
      arena: () => current().options.arena.id,
      startChallenge: (id) => this.startChallenge(id),
      prepareDaily: async () => {
        const daily = await this.prepareDaily();
        const stage = daily.level.stages[0] as StageDef;
        return {
          levelId: daily.level.id,
          objective: stage.objective.type,
          modifier: daily.modifier,
          seed: daily.tuning.seeds[0] ?? 0,
        };
      },
      startDaily: () => this.startDaily(),
      startTutorial: (stage) => this.startTutorial(stage ?? 0),
      gamepadSeats: () => this.gamepads.assignedSeats(),
      back: () => this.back.trigger(),
      wornLooks: () => this.wornLooks(),
      stats: () => this.stats.get(),
      system: () => this.system.state(),
      tips: () => ({
        tutorialDone: this.tips.tutorialDone,
        shown: TIP_IDS.filter((id) => this.tips.seen(id)),
      }),
      tip: () => this.state.tip,
      dailySolution: () => {
        const daily = this.preparedDaily();
        if (!daily) throw new Error('daily challenge not prepared');
        return rleEncode(botPlay(daily.level, 0, daily.tuning.seeds[0] ?? 0).bytes);
      },
      dailyView: () => this.daily.view(this.today()),
      recordStars: (id, stars) => {
        this.progress.record(id, stars);
      },
      challenge: () => {
        const c = this.state.snapshot?.challenge;
        return c
          ? {
              levelId: c.levelId,
              done: c.progress.done,
              target: c.progress.target,
              status: c.status,
              stage: c.progress.stage,
            }
          : null;
      },
      playScript: (log) => {
        const bytes = new Uint8Array(rleLength(log));
        let at = 0;
        for (let i = 0; i < log.length; i += 2) {
          bytes.fill((log[i] as number) & 0xff, at, at + (log[i + 1] as number));
          at += log[i + 1] as number;
        }
        current().setScript(bytes);
      },
      advanceUntilChallengeOver: (maxTicks) => {
        const session = current();
        return session.advanceWhile(() => this.state.screen !== 'challengeResult', maxTicks);
      },
      advanceUntilLobbyDone: (maxTicks) => {
        const session = current();
        return session.advanceWhile(() => !session.lobbyFinished, maxTicks);
      },
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
