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
 */

import type { Application } from 'pixi.js';
import { Hdr, MAX_SEATS, Phase, createState, type ArenaDef, type SimEvent } from '../core';
import { EventKind } from '../core';
import { InputController } from '../input/controller';
import { attachKeyboardInput, attachPointerInput, type PointerClock } from '../input/dom';
import { KeyboardSeats } from '../input/keyboard';
import { TouchZones } from '../input/zones';
import type { GameAudio } from '../audio';
import type { HapticsPort } from '../platform/haptics';
import { ArenaView, type FxStats } from '../render/arenaView';
import type { FxSettings } from '../render/effects';
import { ControlsView, type ControlArea } from '../render/controlsView';
import { solveLayout, type ArenaLayout } from '../render/layout';
import { readSafeInsets } from '../render/safeArea';
import type { ArenaTextures, ControlTextures } from '../render/textures';
import { HapticsDirector } from './haptics';
import { HudSignature, RESULT_DELAY_TICKS, hudModel, type HudModel } from './hud';
import { MatchRunner } from './matchRunner';
import {
  keyBindingsFor,
  matchSetupFor,
  seatPlan,
  zonesFor,
  type GameMode,
  type SeatPlan,
  type ZonePlan,
} from './modes';

export interface SessionOptions {
  readonly mode: GameMode;
  readonly seed: number;
  readonly arena: ArenaDef;
  readonly winsToMatch: number;
  /** Bot seats in the four-corner prototype (default 0). */
  readonly bots?: number;
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

/** Everything the DOM overlay needs to draw the HUD. */
export interface SessionSnapshot {
  readonly mode: GameMode;
  readonly hud: HudModel;
  readonly layout: ArenaLayout;
  readonly plan: readonly SeatPlan[];
  readonly zones: ZonePlan;
}

export interface MatchResult {
  readonly mode: GameMode;
  /** Winning side (= seat in free-for-all). */
  readonly winner: number;
  /** Rounds won per seat. */
  readonly wins: readonly number[];
  readonly rounds: number;
  readonly plan: readonly SeatPlan[];
}

export interface SessionCallbacks {
  onSnapshot?(snapshot: SessionSnapshot): void;
  /** Called once, `RESULT_DELAY_TICKS` after the deciding round. */
  onMatchOver?(result: MatchResult): void;
}

export class GameSession {
  readonly runner: MatchRunner;
  readonly plan: SeatPlan[];
  readonly zones = new TouchZones();
  private readonly keyboard: KeyboardSeats;
  private readonly controller: InputController;
  private readonly view: ArenaView;
  private readonly controls: ControlsView;
  private readonly detach: Array<() => void> = [];
  private layout: ArenaLayout;
  private zonePlan: ZonePlan;
  private layoutKey = '';
  private lastW = -1;
  private lastH = -1;
  private insetPoll = 0;
  private snapshotKey = '';
  private readonly hudSig = new HudSignature();
  private matchEndTick = -1;
  private resultSent = false;
  private inputEnabled = true;
  private readonly audio: GameAudio | undefined;
  private readonly haptics: HapticsDirector | undefined;
  private readonly tickerFn: (ticker: { deltaMS: number }) => void;

  constructor(
    private readonly app: Application,
    arenaTex: ArenaTextures,
    controlTex: ControlTextures,
    readonly options: SessionOptions,
    private readonly callbacks: SessionCallbacks = {},
  ) {
    const { mode } = options;
    this.plan = seatPlan(mode, options.bots);
    const state = createState(matchSetupFor(mode, options));
    this.keyboard = new KeyboardSeats(keyBindingsFor(mode));
    this.controller = new InputController([this.zones, this.keyboard]);
    this.view = new ArenaView(arenaTex, options.fx);
    this.view.bindArena(state, options.arena.theme);
    this.controls = new ControlsView(controlTex, arenaTex);
    app.stage.addChild(this.view.root, this.controls.root);

    this.runner = new MatchRunner(
      state,
      (_st, out) => {
        if (this.inputEnabled) this.controller.sample(out);
        else out.fill(0);
      },
      this.view,
      options.speed ?? 1,
    );
    this.audio = options.feel?.audio;
    const humans = this.plan.filter((p) => p.kind === 'human').map((p) => p.seat);
    this.haptics = options.feel?.haptics
      ? new HapticsDirector(options.feel.haptics, humans, options.feel.hapticsOn ?? false)
      : undefined;
    this.runner.onEvents((events) => this.onEvents(events));
    const audio = this.audio;
    if (audio) {
      this.runner.onTick((st) => audio.onTick(st));
      audio.match(options.seed);
    }
    this.runner.setPaused(options.manualClock);

    if (mode !== 'attract') {
      this.detach.push(attachPointerInput(this.zones, window, options.pointerClock));
      this.detach.push(attachKeyboardInput(this.keyboard));
    }

    this.layout = solveLayout({ width: app.screen.width, height: app.screen.height });
    this.zonePlan = zonesFor(mode, this.layout, options.bots);
    this.relayout();
    this.tickerFn = (ticker) => this.frame(ticker.deltaMS);
    app.ticker.add(this.tickerFn);
    this.present();
  }

  get mode(): GameMode {
    return this.options.mode;
  }

  getLayout(): ArenaLayout {
    return this.layout;
  }

  getZonePlan(): ZonePlan {
    return this.zonePlan;
  }

  hud(): HudModel {
    return hudModel(this.runner.state);
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
    this.runner.loop.setSpeed(speed);
  }

  setHaptics(enabled: boolean): void {
    this.haptics?.setEnabled(enabled);
  }

  /** Simulates `ticks` ticks now (sampling inputs every tick), then redraws and publishes. */
  advance(ticks: number): void {
    this.advanceWhile(() => true, ticks);
  }

  /**
   * Simulates tick by tick while `more()` holds, at most `maxTicks`, then redraws and publishes.
   * Returns the ticks simulated.
   */
  advanceWhile(more: () => boolean, maxTicks: number): number {
    let n = 0;
    while (n < maxTicks && more()) {
      this.runner.stepOnce();
      n++;
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
    this.runner.draw();
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
    this.runner.frame(dtMs);
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
    const key = `${width}x${height}:${safe.top},${safe.right},${safe.bottom},${safe.left}`;
    this.lastW = width;
    this.lastH = height;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.layout = solveLayout({ width, height, safe });
    this.zonePlan = zonesFor(this.mode, this.layout, this.options.bots);
    this.view.setLayout(this.layout);
    this.zones.setLayout(this.zonePlan.zones, this.zonePlan.arena);
    const areas: ControlArea[] =
      this.mode === 'solo'
        ? [
            { seat: 0, rect: this.zonePlan.left },
            { seat: 0, rect: this.zonePlan.right },
          ]
        : this.zonePlan.zones.map((z) => ({ seat: z.seat, rect: z.rect }));
    this.controls.setZones(areas, this.zones.views(), this.zonePlan.stickHints);
    this.controls.render(this.zones.views());
    this.snapshotKey = '';
  }

  private onEvents(events: readonly SimEvent[]): void {
    for (const e of events) if (e.kind === EventKind.MATCH_END) this.matchEndTick = e.tick;
    this.view.pushEvents(events, this.runner.state);
    this.audio?.onEvents(events);
    this.haptics?.onEvents(events);
  }

  private publish(): void {
    // Allocation-free per frame; the HUD model is only built when something visible changed.
    const changed = this.hudSig.update(this.runner.state);
    if (changed || this.snapshotKey !== this.layoutKey) {
      this.snapshotKey = this.layoutKey;
      this.callbacks.onSnapshot?.({
        mode: this.mode,
        hud: hudModel(this.runner.state),
        layout: this.layout,
        plan: this.plan,
        zones: this.zonePlan,
      });
    }
    this.checkResult();
  }

  /** Reports the match result once `RESULT_DELAY_TICKS` have passed since the match ended. */
  private checkResult(): void {
    const state = this.runner.state;
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
        plan: this.plan,
      });
    }
  }
}
