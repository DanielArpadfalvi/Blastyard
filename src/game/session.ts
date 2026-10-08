/**
 * One running match on screen: simulation + input + renderer + HUD feed.
 *
 *   touch zones / keyboard ─┐
 *                           ├─ InputController.sample() ─┐
 *                              (bots run inside `step`) ─┴─ MatchRunner (fixed 60 Hz `step`)
 *                                                            └─ ArenaView + ControlsView (Pixi)
 *                                                            └─ HUD snapshot → Preact overlay
 *                                                            └─ events → effects, audio, haptics
 *
 * Bot seats are part of the match setup: `step` computes their inputs itself (own RNG streams),
 * so the human input log plus the setup reproduces a match exactly. With a manual clock (e2e)
 * the runner never advances on its own; ticks only run through {@link GameSession.advance}.
 *
 * Besides the fixed modes (solo, face-off, four-corner prototype, attract) a session can be
 *  - a **party** match (T5.1) from a resolved {@link PartyPlan}, or its warm-up **lobby**
 *    (`lobby: true`): the same arena without crates, nobody can be hurt, seats join by touching
 *    their zone and become ready by resting a finger for a second ({@link LobbyTracker});
 *  - a **challenge** (T5.2): one human, optional bots / monsters / flag, an objective watched by
 *    a {@link ChallengeTracker}; a gauntlet swaps in the next stage's state when a stage is won.
 * A match can be paused (`setPaused`): the clock stops, touches are dropped, nothing advances
 * until it is resumed.
 */

import type { Application } from 'pixi.js';
import {
  EventKind,
  Hdr,
  MAX_SEATS,
  Phase,
  createState,
  type ArenaDef,
  type SimEvent,
  type SimState,
} from '../core';
import { InputController } from '../input/controller';
import { attachKeyboardInput, attachPointerInput, type PointerClock } from '../input/dom';
import { KeyboardSeats } from '../input/keyboard';
import { nextOrientation, type SeatOrientation } from '../input/rotation';
import { TouchZones } from '../input/zones';
import type { GameAudio } from '../audio';
import type { HapticsPort } from '../platform/haptics';
import { ArenaView, type FxStats } from '../render/arenaView';
import type { FxSettings } from '../render/effects';
import { ControlsView, type ControlArea } from '../render/controlsView';
import { solveLayout, type ArenaLayout } from '../render/layout';
import { readSafeInsets } from '../render/safeArea';
import type { ArenaTextures, ControlTextures } from '../render/textures';
import {
  ChallengeTracker,
  starsFor,
  stageSetup,
  type LevelDef,
  type LevelTuning,
  type LossReason,
  type ObjectiveProgress,
  type RunStats,
  type RunStatus,
  type StageDef,
  type StarCond,
} from './challenge';
import { tipForEvent, type TipId } from './tips';
import type { DailyOutcome } from './dailyStore';
import { HapticsDirector } from './haptics';
import { HudSignature, RESULT_DELAY_TICKS, hudModel, type HudModel } from './hud';
import { LobbyTracker, type LobbySeatView } from './lobby';
import { MatchRunner } from './matchRunner';
import {
  keyBindingsFor,
  layoutKindOf,
  matchSetupFor,
  seatPlan,
  zonesForPlan,
  type GameMode,
  type LayoutKind,
  type SeatPlan,
  type ZonePlan,
} from './modes';
import { partyMatchSetup, type PartyPlan } from './party';

export interface SessionOptions {
  readonly mode: GameMode;
  readonly seed: number;
  readonly arena: ArenaDef;
  readonly winsToMatch: number;
  /** Bot seats in the four-corner prototype (default 0). */
  readonly bots?: number;
  /** `party` mode: seats, layout, rules and teams. */
  readonly party?: PartyPlan;
  /** `party` mode: the warm-up lobby instead of the match. */
  readonly lobby?: boolean;
  /** `challenge` mode: the level and its tuning (seeds, star thresholds). */
  readonly challenge?: {
    readonly level: LevelDef;
    readonly tuning: LevelTuning;
    /** Stage to begin at (the tutorial resumes at a lost step). */
    readonly startStage?: number;
  };
  /** Never advance on real time (tests drive ticks through `advance`). */
  readonly manualClock: boolean;
  /** Gesture clock for tap classification (tests); default: event timestamps. */
  readonly pointerClock?: PointerClock;
  /** Effect settings (reduced motion, quality). */
  readonly fx?: FxSettings;
  /** Real-time clock factor (game speed 0.7 / 0.85 / 1); never changes simulation results. */
  readonly speed?: number;
  /** Sound and haptics; a session without them is silent (the attract match). */
  readonly feel?: SessionFeel;
}

export interface SessionFeel {
  readonly audio?: GameAudio;
  readonly haptics?: HapticsPort;
  readonly hapticsOn?: boolean;
}

/** What the DOM overlay shows about a running challenge. */
export interface ChallengeHud {
  readonly levelId: string;
  readonly progress: ObjectiveProgress;
  readonly status: RunStatus;
}

/** Everything the DOM overlay needs to draw the HUD. */
export interface SessionSnapshot {
  readonly mode: GameMode;
  /** The zone layout in use. */
  readonly kind: LayoutKind;
  readonly hud: HudModel;
  readonly layout: ArenaLayout;
  readonly plan: readonly SeatPlan[];
  readonly zones: ZonePlan;
  /** 2v2: team per seat. */
  readonly teams: readonly number[] | null;
  readonly paused: boolean;
  /** Lobby only: join / ready state of every human seat. */
  readonly lobby: readonly LobbySeatView[] | null;
  readonly challenge: ChallengeHud | null;
}

export interface MatchResult {
  readonly mode: GameMode;
  /** Winning side (= seat in free-for-all, team id in 2v2). */
  readonly winner: number;
  /** Rounds won per seat. */
  readonly wins: readonly number[];
  readonly rounds: number;
  readonly plan: readonly SeatPlan[];
  readonly teams: readonly number[] | null;
}

/** How a challenge ended. */
export interface ChallengeResult {
  readonly level: LevelDef;
  readonly won: boolean;
  readonly reason: LossReason | null;
  readonly stats: RunStats;
  /** 0 when lost, else 1–3. */
  readonly stars: number;
  /** The two extra star conditions (stars 2 and 3) and whether each is met. */
  readonly conds: ReadonlyArray<{ readonly cond: StarCond; readonly met: boolean }>;
  /** Index of the stage the run ended on. */
  readonly stage: number;
  /** Daily challenge only (added by the shell): official / practice, best and streak. */
  readonly daily?: DailyOutcome;
}

export interface SessionCallbacks {
  onSnapshot?(snapshot: SessionSnapshot): void;
  /** Called once, `RESULT_DELAY_TICKS` after the deciding round. */
  onMatchOver?(result: MatchResult): void;
  /** Lobby: everybody is ready; `orientations` are the (possibly turned) seat orientations. */
  onLobbyDone?(orientations: readonly SeatOrientation[]): void;
  /** Challenge: won or lost (after a short beat to see what happened). */
  onChallengeOver?(result: ChallengeResult): void;
  /** A human seat met something a first-time tip explains (T5.4); the shell decides to show it. */
  onTip?(tip: TipId): void;
}

/** Ticks the arena keeps running after a challenge is won / lost before the result shows. */
export const CHALLENGE_WIN_DELAY = 60;
export const CHALLENGE_LOSS_DELAY = 90;
/** Gauntlet: ticks between a won stage and the next stage's countdown. */
export const STAGE_DELAY = 60;

const NO_EVENTS: readonly SimEvent[] = [];

/** Seats of a challenge stage: the player in seat 0, its bots after it. */
function stagePlan(stage: StageDef | undefined): SeatPlan[] {
  const bots = stage?.bots ?? [];
  return [0, 1, 2, 3].map((seat): SeatPlan => {
    if (seat === 0) return { seat, kind: 'human', orientation: 0 };
    if (seat <= bots.length) {
      return { seat, kind: 'bot', orientation: 0, botLevel: bots[seat - 1] as number };
    }
    return { seat, kind: 'off', orientation: 0 };
  });
}

/** The arena of a warm-up lobby: the match arena without crates, so there is room to play. */
export function lobbyArena(arena: ArenaDef): ArenaDef {
  return { ...arena, id: `${arena.id}-lobby`, crateDensity: 0 };
}

export class GameSession {
  readonly plan: SeatPlan[];
  readonly zones = new TouchZones();
  readonly kind: LayoutKind;
  private runnerRef: MatchRunner;
  private readonly keyboard: KeyboardSeats;
  private readonly controller: InputController;
  private view: ArenaView;
  private readonly controls: ControlsView;
  private readonly detach: Array<() => void> = [];
  private layout: ArenaLayout;
  private zonePlan: ZonePlan;
  private layoutKey = '';
  private lastW = -1;
  private lastH = -1;
  private insetPoll = 0;
  private snapshotKey = '';
  private extraKey = '';
  private orientVersion = 0;
  private readonly hudSig = new HudSignature();
  private matchEndTick = -1;
  private resultSent = false;
  private inputEnabled = true;
  private userPaused = false;
  private readonly lastInputs = new Uint8Array(MAX_SEATS);
  private script: Uint8Array | null = null;
  private pendingEvents: readonly SimEvent[] = NO_EVENTS;
  private readonly lobbyTracker: LobbyTracker | null;
  private lobbyDone = false;
  private readonly tracker: ChallengeTracker | null;
  private challengeDelay = -1;
  private challengeSent = false;
  private stageTimer = -1;
  private stageSwapDue = false;
  private readonly audio: GameAudio | undefined;
  private readonly haptics: HapticsDirector | undefined;
  private readonly tickerFn: (ticker: { deltaMS: number }) => void;

  constructor(
    private readonly app: Application,
    private readonly arenaTex: ArenaTextures,
    controlTex: ControlTextures,
    readonly options: SessionOptions,
    private readonly callbacks: SessionCallbacks = {},
  ) {
    const { mode } = options;
    if (mode === 'party' && !options.party) throw new Error('party mode needs a party plan');
    if (mode === 'challenge' && !options.challenge) throw new Error('challenge mode needs a level');
    this.plan = this.initialPlan();
    this.kind = options.party?.layout ?? layoutKindOf(mode);
    this.tracker = options.challenge
      ? new ChallengeTracker(options.challenge.level, options.challenge.startStage ?? 0)
      : null;
    const state = this.initialState();
    this.keyboard = new KeyboardSeats(keyBindingsFor(mode, this.plan));
    this.controller = new InputController([this.zones, this.keyboard]);
    this.view = new ArenaView(arenaTex, options.fx);
    this.view.bindArena(state, this.stageArena().theme);
    this.controls = new ControlsView(controlTex, arenaTex);
    app.stage.addChild(this.view.root, this.controls.root);

    this.audio = options.feel?.audio;
    const humans = this.plan.filter((p) => p.kind === 'human').map((p) => p.seat);
    this.haptics = options.feel?.haptics
      ? new HapticsDirector(options.feel.haptics, humans, options.feel.hapticsOn ?? false)
      : undefined;
    this.lobbyTracker = options.lobby ? new LobbyTracker(humans) : null;
    this.runnerRef = this.makeRunner(state);
    if (this.audio) this.audio.match(options.seed);
    this.runnerRef.setPaused(options.manualClock);

    if (mode !== 'attract') {
      this.detach.push(attachPointerInput(this.zones, window, options.pointerClock));
      this.detach.push(attachKeyboardInput(this.keyboard));
    }

    this.layout = solveLayout({ width: app.screen.width, height: app.screen.height });
    this.zonePlan = zonesForPlan(this.kind, this.layout, this.plan);
    this.relayout();
    this.tickerFn = (ticker) => this.frame(ticker.deltaMS);
    app.ticker.add(this.tickerFn);
    this.present();
  }

  /** The simulation runner of the current stage / match. */
  get runner(): MatchRunner {
    return this.runnerRef;
  }

  get mode(): GameMode {
    return this.options.mode;
  }

  get paused(): boolean {
    return this.userPaused;
  }

  private initialPlan(): SeatPlan[] {
    const { mode, party, challenge } = this.options;
    if (party) return party.seats.map((p) => ({ ...p }));
    if (challenge) return stagePlan(challenge.level.stages[challenge.startStage ?? 0]);
    return seatPlan(mode, this.options.bots);
  }

  private initialState(): SimState {
    const { mode, party, challenge, lobby, seed, arena } = this.options;
    if (party) {
      return createState(
        partyMatchSetup(party, seed, lobby ? lobbyArena(arena) : arena, lobby === true),
      );
    }
    if (challenge) {
      const k = challenge.startStage ?? 0;
      return createState(stageSetup(challenge.level, k, challenge.tuning.seeds[k] ?? seed));
    }
    return createState(matchSetupFor(mode, this.options));
  }

  /** Arena of the stage / match being played (theme for the renderer). */
  private stageArena(): ArenaDef {
    return this.tracker ? this.tracker.stageDef.arena : this.options.arena;
  }

  private makeRunner(state: SimState): MatchRunner {
    const runner = new MatchRunner(
      state,
      (st, out) => {
        if (this.inputEnabled && !this.userPaused) {
          this.controller.sample(out);
          // A script (tests, replays) drives seat 0 instead of the touch zones.
          if (this.script) out[0] = this.script[st.hdr[Hdr.TICK] as number] ?? 0;
        } else out.fill(0);
        this.lastInputs.set(out);
      },
      this.view,
      this.options.speed ?? 1,
    );
    runner.onEvents((events) => this.onEvents(events));
    runner.onTick((st) => {
      this.audio?.onTick(st);
      this.afterTick(runner);
    });
    return runner;
  }

  getLayout(): ArenaLayout {
    return this.layout;
  }

  getZonePlan(): ZonePlan {
    return this.zonePlan;
  }

  hud(): HudModel {
    return hudModel(this.runnerRef.state);
  }

  /** Effects currently on screen. */
  fxStats(): FxStats {
    return this.view.getFxStats();
  }

  setFx(fx: FxSettings): void {
    this.view.setFx(fx);
  }

  /** Game speed (real-time clock factor). */
  setSpeed(speed: number): void {
    this.runnerRef.loop.setSpeed(speed);
  }

  setHaptics(enabled: boolean): void {
    this.haptics?.setEnabled(enabled);
  }

  /** Pauses / resumes the match (clock and input); a paused match keeps its frame on screen. */
  setPaused(paused: boolean): void {
    if (paused === this.userPaused) return;
    this.userPaused = paused;
    this.runnerRef.setPaused(paused || this.options.manualClock);
    if (paused) {
      this.zones.reset();
      this.keyboard.reset();
    }
    this.present();
  }

  /** Lobby: turns the orientation of `seat` by 90° (the arrow in its zone). */
  turnSeat(seat: number): void {
    const p = this.plan[seat];
    if (!p || p.kind === 'off' || this.kind === 'solo') return;
    this.setOrientation(seat, nextOrientation(p.orientation));
  }

  setOrientation(seat: number, orientation: SeatOrientation): void {
    const p = this.plan[seat];
    if (!p) return;
    this.plan[seat] = { ...p, orientation };
    this.orientVersion++;
    this.layoutKey = '';
    this.zones.reset();
    this.present();
  }

  /** Drives seat 0 from one input byte per tick (indexed by the stage's tick), or `null`. */
  setScript(bytes: Uint8Array | null): void {
    this.script = bytes;
  }

  /** Lobby: has everybody been ready long enough for the match to start? */
  get lobbyFinished(): boolean {
    return this.lobbyDone;
  }

  /** Lobby: marks every human seat ready (accessibility / desktop). */
  readyAll(): void {
    this.lobbyTracker?.readyAll();
    this.present();
  }

  /** Simulates `ticks` ticks now (sampling inputs every tick), then redraws and publishes. */
  advance(ticks: number): void {
    this.advanceWhile(() => true, ticks);
  }

  /**
   * Simulates tick by tick while `more()` holds, at most `maxTicks`, then redraws and publishes.
   * Returns the ticks simulated (0 while paused).
   */
  advanceWhile(more: () => boolean, maxTicks: number): number {
    let n = 0;
    while (!this.userPaused && n < maxTicks && more()) {
      this.runnerRef.stepOnce();
      n++;
      this.swapStageIfDue();
      this.checkResult();
    }
    this.present();
    return n;
  }

  /**
   * Draws the current tick and presents it right away. With a manual clock the app ticker is
   * stopped (nothing moves on its own), so this is the only time the canvas updates.
   */
  present(): void {
    this.relayout();
    this.runnerRef.draw();
    this.controls.render(this.zones.views());
    this.app.render();
    this.publish();
  }

  /** Stops reading touches and keys (the match is over); the arena stays on screen. */
  disableInput(): void {
    this.inputEnabled = false;
    for (const off of this.detach.splice(0)) off();
    this.zones.reset();
    this.keyboard.reset();
    this.controls.root.visible = false;
  }

  destroy(): void {
    this.audio?.quiet();
    this.disableInput();
    this.app.ticker.remove(this.tickerFn);
    this.view.destroy();
    this.controls.destroy();
  }

  private frame(dtMs: number): void {
    this.relayout();
    this.runnerRef.frame(dtMs);
    this.swapStageIfDue();
    this.controls.render(this.zones.views());
    this.publish();
  }

  private relayout(): void {
    const { width, height } = this.app.screen;
    // getComputedStyle forces a style recalc: re-read the safe-area insets on a size change and
    // about once a second, not every frame.
    const sizeChanged = width !== this.lastW || height !== this.lastH;
    if (!sizeChanged && this.layoutKey !== '' && ++this.insetPoll < 60) return;
    this.insetPoll = 0;
    const safe = readSafeInsets();
    const key = `${width}x${height}:${safe.top},${safe.right},${safe.bottom},${safe.left}:${this.orientVersion}`;
    this.lastW = width;
    this.lastH = height;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.layout = solveLayout({ width, height, safe });
    this.zonePlan = zonesForPlan(this.kind, this.layout, this.plan);
    this.view.setLayout(this.layout);
    this.zones.setLayout(this.zonePlan.zones, this.zonePlan.arena);
    const soloSeat = this.zonePlan.zones[0]?.seat ?? 0;
    const areas: ControlArea[] =
      this.kind === 'solo'
        ? [
            { seat: soloSeat, rect: this.zonePlan.left },
            { seat: soloSeat, rect: this.zonePlan.right },
          ]
        : this.zonePlan.zones.map((z) => ({ seat: z.seat, rect: z.rect }));
    this.controls.setZones(areas, this.zones.views(), this.zonePlan.stickHints);
    this.controls.render(this.zones.views());
    this.snapshotKey = '';
  }

  private onEvents(events: readonly SimEvent[]): void {
    this.pendingEvents = events;
    for (const e of events) if (e.kind === EventKind.MATCH_END) this.matchEndTick = e.tick;
    this.view.pushEvents(events, this.runnerRef.state);
    this.audio?.onEvents(events);
    this.haptics?.onEvents(events);
    if (this.callbacks.onTip && this.mode !== 'attract' && !this.lobbyTracker) {
      for (const e of events) {
        const tip = tipForEvent(e, this.humanSeats);
        if (tip) this.callbacks.onTip(tip);
      }
    }
  }

  private get humanSeats(): number[] {
    return this.plan.filter((p) => p.kind === 'human').map((p) => p.seat);
  }

  /** Per-tick bookkeeping after `step`: lobby readiness, challenge objective. */
  private afterTick(runner: MatchRunner): void {
    const events = this.pendingEvents;
    this.pendingEvents = NO_EVENTS;
    if (runner !== this.runnerRef) return;
    const lobby = this.lobbyTracker;
    if (lobby) {
      for (const p of this.plan) {
        if (p.kind !== 'human') continue;
        lobby.update(p.seat, this.zones.touching(p.seat), this.lastInputs[p.seat] as number);
      }
      if (lobby.tickStart() && !this.lobbyDone) {
        this.lobbyDone = true;
        this.callbacks.onLobbyDone?.(this.plan.map((p) => p.orientation));
      }
    }
    const tracker = this.tracker;
    if (!tracker) return;
    if (this.challengeDelay > 0) {
      this.challengeDelay--;
    } else if (this.challengeDelay < 0) {
      tracker.observe(runner.state, events);
      if (tracker.status !== 'running') {
        this.challengeDelay = tracker.status === 'won' ? CHALLENGE_WIN_DELAY : CHALLENGE_LOSS_DELAY;
      } else if (tracker.stageWon) {
        if (this.stageTimer < 0) this.stageTimer = STAGE_DELAY;
        else if (--this.stageTimer === 0) this.stageSwapDue = true;
      }
    }
  }

  /** Gauntlet: swaps in the next stage once the beat after a won stage is over. */
  private swapStageIfDue(): void {
    const tracker = this.tracker;
    const challenge = this.options.challenge;
    if (!tracker || !challenge || !this.stageSwapDue) return;
    this.stageSwapDue = false;
    this.stageTimer = -1;
    tracker.advance();
    const index = tracker.stage;
    const state = createState(
      stageSetup(challenge.level, index, challenge.tuning.seeds[index] ?? this.options.seed),
    );
    this.view.destroy();
    this.view = new ArenaView(this.arenaTex, this.options.fx);
    this.view.bindArena(state, tracker.stageDef.arena.theme);
    this.app.stage.addChildAt(this.view.root, 0);
    this.view.setLayout(this.layout);
    // The next stage may bring other bots: their seats get HUD panels.
    this.plan.splice(0, this.plan.length, ...stagePlan(tracker.stageDef));
    this.layoutKey = '';
    this.matchEndTick = -1;
    const old = this.runnerRef;
    this.runnerRef = this.makeRunner(state);
    this.runnerRef.setPaused(old.isPaused());
    this.runnerRef.loop.setSpeed(old.loop.getSpeed());
    this.hudSig.reset();
    this.snapshotKey = '';
    this.audio?.match(this.options.seed + index);
  }

  private challengeKey(): string {
    const tracker = this.tracker;
    if (!tracker) return '';
    const p = tracker.progress(this.runnerRef.state);
    return `${tracker.status}/${p.stage}/${p.done}/${p.target}/${p.secondsLeft}`;
  }

  private publish(): void {
    // Allocation-free per frame; the HUD model is only built when something visible changed.
    const state = this.runnerRef.state;
    const changed = this.hudSig.update(state);
    const extra = `${+this.userPaused}|${this.lobbyTracker?.key() ?? ''}|${this.challengeKey()}|${this.orientVersion}`;
    if (changed || this.snapshotKey !== this.layoutKey || extra !== this.extraKey) {
      this.snapshotKey = this.layoutKey;
      this.extraKey = extra;
      const tracker = this.tracker;
      const challenge = this.options.challenge;
      this.callbacks.onSnapshot?.({
        mode: this.mode,
        kind: this.kind,
        hud: hudModel(state),
        layout: this.layout,
        plan: this.plan.slice(),
        zones: this.zonePlan,
        teams: this.options.party?.teams ?? null,
        paused: this.userPaused,
        lobby: this.lobbyTracker ? this.lobbyTracker.views() : null,
        challenge:
          tracker && challenge
            ? {
                levelId: challenge.level.id,
                progress: tracker.progress(state),
                status: tracker.status,
              }
            : null,
      });
    }
    this.checkResult();
  }

  /** Reports a decided match / challenge once its short beat has passed. */
  private checkResult(): void {
    const state = this.runnerRef.state;
    const tracker = this.tracker;
    const challenge = this.options.challenge;
    if (tracker && challenge) {
      if (!this.challengeSent && tracker.status !== 'running' && this.challengeDelay === 0) {
        this.challengeSent = true;
        const won = tracker.status === 'won';
        const stats = tracker.totals();
        const conds = challenge.tuning.stars.map((cond) => ({
          cond,
          met: won && starsFor(true, stats, [cond]) === 2,
        }));
        this.callbacks.onChallengeOver?.({
          level: challenge.level,
          won,
          reason: tracker.lossReason,
          stats,
          stars: won ? starsFor(true, stats, challenge.tuning.stars) : 0,
          conds,
          stage: tracker.stage,
        });
      }
      return;
    }
    if (
      !this.resultSent &&
      this.matchEndTick >= 0 &&
      state.hdr[Hdr.PHASE] === Phase.MATCH_OVER &&
      (state.hdr[Hdr.TICK] as number) - this.matchEndTick >= RESULT_DELAY_TICKS
    ) {
      this.resultSent = true;
      const hud = hudModel(state);
      const wins: number[] = [];
      for (let s = 0; s < MAX_SEATS; s++) wins.push(hud.seats[s]?.wins ?? 0);
      this.callbacks.onMatchOver?.({
        mode: this.mode,
        winner: state.hdr[Hdr.MATCH_WINNER] as number,
        wins,
        rounds: state.hdr[Hdr.ROUND] as number,
        plan: this.plan.slice(),
        teams: this.options.party?.teams ?? null,
      });
    }
  }
}
