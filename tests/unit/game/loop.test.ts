import { describe, expect, it } from 'vitest';
import { CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import {
  EventKind,
  Hdr,
  MAX_SEATS,
  Phase,
  createState,
  stateHash,
  step,
  type SimEvent,
} from '../../../src/core';
import { DEMO_CYCLE, demoInput } from '../../../src/game/demoScript';
import { FixedTickLoop, MAX_FRAME_MS, MAX_TICKS_PER_FRAME, TICK_MS } from '../../../src/game/loop';
import { MatchRunner, idleInputs, type MatchView } from '../../../src/game/matchRunner';
import type { TickHistory } from '../../../src/render/interpolation';
import type { ReadonlySimState } from '../../../src/render/readonlyState';

describe('FixedTickLoop', () => {
  it('turns real time into whole ticks and keeps the remainder as alpha', () => {
    const loop = new FixedTickLoop();
    expect(loop.advance(TICK_MS * 2.5)).toBe(2);
    expect(loop.alpha).toBeCloseTo(0.5);
    expect(loop.advance(TICK_MS * 0.5)).toBe(1);
    expect(loop.alpha).toBeCloseTo(0, 5);
  });

  it('runs 60 ticks per second at 60 or 30 FPS', () => {
    for (const fps of [60, 30, 144]) {
      const loop = new FixedTickLoop();
      let ticks = 0;
      for (let f = 0; f < fps * 10; f++) ticks += loop.advance(1000 / fps);
      expect(Math.abs(ticks - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('slows the tick rate with the game-speed option', () => {
    const loop = new FixedTickLoop(0.7);
    let ticks = 0;
    for (let f = 0; f < 600; f++) ticks += loop.advance(1000 / 60);
    expect(Math.abs(ticks - 420)).toBeLessThanOrEqual(1);
    loop.setSpeed(Number.NaN);
    expect(loop.getSpeed()).toBe(1);
  });

  it('drops long stalls instead of spiralling', () => {
    const loop = new FixedTickLoop();
    expect(loop.advance(10_000)).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
    expect(loop.advance(MAX_FRAME_MS)).toBe(MAX_TICKS_PER_FRAME);
    expect(loop.alpha).toBe(0);
    expect(loop.advance(-5)).toBe(0);
    expect(loop.advance(Number.NaN)).toBe(0);
  });
});

class RecordingView implements MatchView {
  calls: Array<{ tick: number; prevTick: number; alpha: number }> = [];
  render(state: ReadonlySimState, history: TickHistory, alpha: number): void {
    this.calls.push({ tick: state.hdr[Hdr.TICK] as number, prevTick: history.tick, alpha });
  }
}

function newState(seed = 1) {
  return createState({ seed, arena: CLASSIC_ARENAS[0]!, seats: [true, true, true, true] });
}

describe('MatchRunner', () => {
  it('records the previous tick before each step and renders with the loop alpha', () => {
    const view = new RecordingView();
    const runner = new MatchRunner(newState(), idleInputs, view);
    runner.frame(TICK_MS * 3.25);
    const last = view.calls.at(-1)!;
    expect(last.tick).toBe(3);
    expect(last.prevTick).toBe(2);
    expect(last.alpha).toBeCloseTo(0.25);
  });

  it('freezes while paused and draws the exact latest tick', () => {
    const view = new RecordingView();
    const runner = new MatchRunner(newState(), idleInputs, view);
    runner.setPaused(true);
    runner.frame(1000);
    expect(view.calls.at(-1)).toEqual({ tick: 0, prevTick: 0, alpha: 1 });
    runner.advance(10);
    expect(view.calls.at(-1)!.tick).toBe(10);
  });

  it('plays exactly like stepping the core directly (same inputs, same hashes)', () => {
    const viaRunner = new MatchRunner(
      newState(9),
      (st, out) => {
        for (let s = 0; s < MAX_SEATS; s++) out[s] = demoInput(st, s);
      },
      new RecordingView(),
    );
    const events: SimEvent[] = [];
    viaRunner.onEvents((e) => events.push(...e));
    viaRunner.advance(900);
    const direct = newState(9);
    const inputs = new Uint8Array(MAX_SEATS);
    for (let t = 0; t < 900; t++) {
      for (let s = 0; s < MAX_SEATS; s++) inputs[s] = demoInput(direct, s);
      step(direct, inputs);
    }
    expect(stateHash(viaRunner.state)).toBe(stateHash(direct));
    expect(events.some((e) => e.kind === EventKind.BOMB_PLACED)).toBe(true);
  });
});

describe('demo script', () => {
  it('drops pops, breaks crates and keeps every Puff alive on all classic arenas', () => {
    for (const arena of CLASSIC_ARENAS) {
      const state = createState({ seed: 1, arena, seats: [true, true, true, true] });
      const inputs = new Uint8Array(MAX_SEATS);
      let bombs = 0;
      let crates = 0;
      for (let t = 0; t < 180 + 4 * DEMO_CYCLE; t++) {
        for (let s = 0; s < MAX_SEATS; s++) inputs[s] = demoInput(state, s);
        for (const e of step(state, inputs)) {
          if (e.kind === EventKind.BOMB_PLACED) bombs++;
          if (e.kind === EventKind.CRATE_DESTROYED) crates++;
          expect(e.kind, `${arena.id}: nobody dies in the demo`).not.toBe(EventKind.DEATH);
        }
      }
      expect(state.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
      expect(bombs).toBeGreaterThanOrEqual(12);
      expect(crates).toBeGreaterThan(4);
    }
  });

  it('gives no input outside the playing phase', () => {
    const state = newState();
    expect(state.hdr[Hdr.PHASE]).toBe(Phase.COUNTDOWN);
    for (let s = 0; s < MAX_SEATS; s++) expect(demoInput(state, s)).toBe(0);
  });
});
