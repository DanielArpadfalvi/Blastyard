/**
 * One running match on screen: simulation + input + renderer + HUD feed.
 *
 *   touch zones / keyboard ─┐
 *                           ├─ InputController.sample() ─┐
 *   wander bot (bot seats) ─┴────────────────────────────┴─ MatchRunner (fixed 60 Hz `step`)
 *                                                            └─ ArenaView + ControlsView (Pixi)
 *                                                            └─ HUD snapshot → Preact overlay
 *
 * Bot inputs are computed from the state right before each tick and fed to `step` like any
 * other seat byte, so the input log of a match reproduces it exactly. With a manual clock (e2e)
 * the runner never advances on its own; ticks only run through {@link GameSession.advance}.
 */

import type { Application } from 'pixi.js';
import {
  Hdr,
  MAX_SEATS,
  Phase,
  createState,
  wanderInput,
  type ArenaDef,
  type SimEvent,
} from '../core';
import { EventKind } from '../core';
import { InputController } from '../input/controller';
import { attachKeyboardInput, attachPointerInput, type PointerClock } from '../input/dom';
import { KeyboardSeats } from '../input/keyboard';
import { TouchZones } from '../input/zones';
import { ArenaView } from '../render/arenaView';
import { ControlsView, type ControlArea } from '../render/controlsView';
import { solveLayout, type ArenaLayout } from '../render/layout';
import { readSafeInsets } from '../render/safeArea';
import type { ArenaTextures, ControlTextures } from '../render/textures';
import { RESULT_DELAY_TICKS, hudKey, hudModel, type HudModel } from './hud';
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
  private snapshotKey = '';
  private matchEndTick = -1;
  private resultSent = false;
  private inputEnabled = true;
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
    this.view = new ArenaView(arenaTex);
    this.controls = new ControlsView(controlTex, arenaTex);
    app.stage.addChild(this.view.root, this.controls.root);

    const bots = this.plan.filter((p) => p.kind === 'bot').map((p) => p.seat);
    this.runner = new MatchRunner(
      state,
      (_st, out) => {
        if (this.inputEnabled) this.controller.sample(out);
        else out.fill(0);
        for (const seat of bots) out[seat] = wanderInput(state, seat);
      },
      this.view,
    );
    this.runner.onEvents((events) => this.onEvents(events));
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
    const safe = readSafeInsets();
    const { width, height } = this.app.screen;
    const key = `${width}x${height}:${safe.top},${safe.right},${safe.bottom},${safe.left}`;
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
  }

  private publish(): void {
    const hud = hudModel(this.runner.state);
    const key = `${hudKey(hud)}#${this.layoutKey}`;
    if (key !== this.snapshotKey) {
      this.snapshotKey = key;
      this.callbacks.onSnapshot?.({
        mode: this.mode,
        hud,
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
