/**
 * Drives one match in real time: fixed-tick accumulator → `step` → render with interpolation.
 *
 * The runner is the only place that advances the simulation; before every `step` it records the
 * previous tick for the renderer's interpolation. Inputs come from an {@link InputProvider}
 * sampled once per tick (touch / keyboard sources, bots outside the core, or a test script).
 */

import { MAX_SEATS, step, type SimEvent, type SimState } from '../core';
import { TickHistory } from '../render/interpolation';
import type { ReadonlySimState } from '../render/readonlyState';
import { FixedTickLoop } from './loop';

/** Fills `out[seat]` with each seat's input byte for the tick about to be simulated. */
export type InputProvider = (state: ReadonlySimState, out: Uint8Array) => void;

/** Something that draws the state (the Pixi `ArenaView`, or a stub in tests). */
export interface MatchView {
  render(state: ReadonlySimState, history: TickHistory, alpha: number): void;
}

export const idleInputs: InputProvider = (_state, out) => {
  out.fill(0);
};

export class MatchRunner {
  readonly history = new TickHistory();
  readonly loop: FixedTickLoop;
  private readonly inputs = new Uint8Array(MAX_SEATS);
  private paused = false;
  private eventListener: ((events: readonly SimEvent[]) => void) | undefined;
  private tickListener: ((state: ReadonlySimState) => void) | undefined;

  constructor(
    readonly state: SimState,
    private provider: InputProvider,
    private readonly view: MatchView,
    speed = 1,
  ) {
    this.loop = new FixedTickLoop(speed);
    this.history.capture(state);
  }

  setInputProvider(provider: InputProvider): void {
    this.provider = provider;
  }

  onEvents(listener: ((events: readonly SimEvent[]) => void) | undefined): void {
    this.eventListener = listener;
  }

  /** Called after every simulated tick (after the events), with the new state (read only). */
  onTick(listener: ((state: ReadonlySimState) => void) | undefined): void {
    this.tickListener = listener;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Pausing freezes the clock; the view keeps showing the latest tick exactly. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.loop.reset();
  }

  /** Simulates exactly one tick. */
  stepOnce(): void {
    this.inputs.fill(0);
    this.provider(this.state, this.inputs);
    this.history.capture(this.state);
    const events = step(this.state, this.inputs);
    if (events.length > 0) this.eventListener?.(events);
    this.tickListener?.(this.state);
  }

  /** Simulates `ticks` ticks immediately (tests, fast-forward) and redraws. */
  advance(ticks: number): void {
    const n = Math.max(0, Math.floor(ticks));
    for (let i = 0; i < n; i++) this.stepOnce();
    this.draw();
  }

  /** One animation frame: runs the ticks due for `dtMs` of real time, then draws. */
  frame(dtMs: number): void {
    if (!this.paused) {
      const ticks = this.loop.advance(dtMs);
      for (let i = 0; i < ticks; i++) this.stepOnce();
    }
    this.draw();
  }

  /** Draws the current state (interpolated while running, exact while paused). */
  draw(): void {
    this.view.render(this.state, this.history, this.paused ? 1 : this.loop.alpha);
  }
}
