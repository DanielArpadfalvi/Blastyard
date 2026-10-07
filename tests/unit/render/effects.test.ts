import { describe, expect, it } from 'vitest';
import { CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import {
  EventKind,
  Hdr,
  MAX_SEATS,
  NO_OWNER,
  Phase,
  addBomb,
  cellIndex,
  createState,
  step,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import { applyShowcase } from '../../../src/game/showcase';
import {
  BLOCK_DROP_TICKS,
  DEATH_TICKS,
  Effects,
  FLASH_TICKS,
  Fx,
  MAX_PARTICLES,
  MAX_SHAKE_PX,
  QUALITY_PARTICLES,
  type FxSettings,
} from '../../../src/render/effects';
import { only, tinyArena } from '../core/helpers';

const FULL: FxSettings = { reducedMotion: false, quality: 2 };
const REDUCED: FxSettings = { reducedMotion: true, quality: 2 };

/** Runs the chain showcase, feeding every tick's events to `fx`; returns the event log. */
function runChain(fx: Effects, ticks = 60): { state: SimState; events: SimEvent[] } {
  const state = createState({
    seed: 5,
    arena: CLASSIC_ARENAS[0]!,
    seats: [true, true, true, true],
  });
  applyShowcase(state, 'chain');
  const idle = new Uint8Array(MAX_SEATS);
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const e = step(state, idle);
    fx.push(e, state);
    events.push(...e);
  }
  return { state, events };
}

function blastTick(events: readonly SimEvent[]): number {
  return events.find((e) => e.kind === EventKind.BOMB_EXPLODED)!.tick;
}

describe('effects', () => {
  it('a blast throws sparks, fire and smoke, shakes (≤ 6 px) and flashes', () => {
    const fx = new Effects();
    fx.setSettings(FULL);
    const state = tinyArena(['#######', '#0....#', '#.o.o.#', '#.....#', '#######']);
    addBomb(state, 3, 3, 0, 1, 2);
    const events = step(state, only(0, 0));
    fx.push(events, state);
    const t = blastTick(events);
    const f = fx.update(t + 3);
    const kinds = new Set(Array.from(f.kind.subarray(0, f.count)));
    expect(kinds.has(Fx.SPARK)).toBe(true);
    expect(kinds.has(Fx.FIRE)).toBe(true);
    expect(f.count).toBeGreaterThan(20);
    expect(Math.hypot(f.shakeX, f.shakeY)).toBeGreaterThan(0);
    expect(Math.hypot(f.shakeX, f.shakeY)).toBeLessThanOrEqual(MAX_SHAKE_PX + 1e-9);
    expect(f.flash).toBeGreaterThan(0);
    // Everything settles: no flash after FLASH_TICKS, no particles after a few seconds.
    expect(fx.update(t + FLASH_TICKS + 1).flash).toBe(0);
    const later = fx.update(t + 200);
    expect(later.count).toBe(0);
    expect(later.shakeX).toBe(0);
    expect(later.shakeY).toBe(0);
  });

  it('caps the shake at 6 px even for a whole chain reaction', () => {
    const fx = new Effects();
    const { events } = runChain(fx);
    const blasts = events.filter((e) => e.kind === EventKind.BOMB_EXPLODED);
    expect(blasts.length).toBeGreaterThanOrEqual(5);
    let max = 0;
    for (let time = blasts[0]!.tick; time < blasts.at(-1)!.tick + 20; time += 0.25) {
      const f = fx.update(time);
      max = Math.max(max, Math.hypot(f.shakeX, f.shakeY));
      expect(f.count).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    expect(max).toBeGreaterThan(3);
    expect(max).toBeLessThanOrEqual(MAX_SHAKE_PX + 1e-9);
  });

  it('reduced motion disables shake and flash and halves the particles', () => {
    const full = new Effects();
    full.setSettings(FULL);
    const reduced = new Effects();
    reduced.setSettings(REDUCED);
    const a = runChain(full);
    runChain(reduced);
    const first = blastTick(a.events);
    let fullShake = 0;
    let fullFlash = 0;
    for (let time = first; time < first + 80; time += 0.5) {
      const f = full.update(time);
      const r = reduced.update(time);
      fullShake = Math.max(fullShake, Math.hypot(f.shakeX, f.shakeY));
      fullFlash = Math.max(fullFlash, f.flash);
      expect(r.shakeX).toBe(0);
      expect(r.shakeY).toBe(0);
      expect(r.flash).toBe(0);
      expect(r.count).toBeLessThanOrEqual(reduced.budget());
    }
    expect(fullShake).toBeGreaterThan(0);
    expect(fullFlash).toBeGreaterThan(0);
    expect(reduced.budget()).toBe(MAX_PARTICLES / 2);
    expect(reduced.totalSpawned).toBeLessThan(full.totalSpawned * 0.7);
  });

  it('switching reduced motion on stops a running shake at once', () => {
    const fx = new Effects();
    const { events } = runChain(fx, 30);
    const t = blastTick(events);
    expect(Math.hypot(fx.update(t + 1).shakeX, fx.update(t + 1).shakeY)).toBeGreaterThan(0);
    fx.setSettings(REDUCED);
    const f = fx.update(t + 1);
    expect(f.shakeX).toBe(0);
    expect(f.flash).toBe(0);
  });

  it('respects the particle budget of each quality level', () => {
    for (const quality of [0, 1, 2] as const) {
      const fx = new Effects();
      fx.setSettings({ reducedMotion: false, quality });
      const { events } = runChain(fx);
      const first = blastTick(events);
      for (let time = first; time < first + 60; time += 1) {
        expect(fx.update(time).count).toBeLessThanOrEqual(QUALITY_PARTICLES[quality]!);
      }
    }
  });

  it('is deterministic: same events, same picture at the same moment', () => {
    const a = new Effects();
    const b = new Effects();
    runChain(a);
    runChain(b);
    for (const time of [45.5, 52, 60.25]) {
      const fa = a.update(time);
      const fb = b.update(time);
      expect(fb.count).toBe(fa.count);
      expect(Array.from(fb.x.subarray(0, fb.count))).toEqual(
        Array.from(fa.x.subarray(0, fa.count)),
      );
      expect(fb.shakeX).toBe(fa.shakeX);
    }
  });

  it('ignores events of a tick it has already seen (re-simulated ticks)', () => {
    const fx = new Effects();
    const e: SimEvent = {
      tick: 5,
      kind: EventKind.BOMB_EXPLODED,
      seat: 0,
      cell: cellIndex(3, 3),
      value: 2,
    };
    const state = tinyArena(['#######', '#0....#', '#######']);
    fx.push([e], state);
    const once = fx.totalSpawned;
    fx.push([e], state);
    expect(fx.totalSpawned).toBe(once);
  });

  it('drops sudden-death blocks from above, then lands them with dust', () => {
    const fx = new Effects();
    const state = tinyArena(['#######', '#0....#', '#######']);
    const cell = cellIndex(2, 1);
    fx.push([{ tick: 100, kind: EventKind.BLOCK_DROPPED, seat: NO_OWNER, cell, value: 0 }], state);
    const mid = fx.update(100 + BLOCK_DROP_TICKS / 2);
    expect(mid.dropCount).toBe(1);
    expect(mid.dropCell[0]).toBe(cell);
    expect(mid.dropProgress[0]).toBeCloseTo(0.5);
    // Dust waits for the landing.
    expect(mid.count).toBe(0);
    const landed = fx.update(100 + BLOCK_DROP_TICKS + 2);
    expect(landed.count).toBeGreaterThan(0);
    expect(fx.update(100 + BLOCK_DROP_TICKS + 3).dropCount).toBe(0);
  });

  it('deflates an eliminated Puff and pulses Puffs that drop a pop or grab a pickup', () => {
    const fx = new Effects();
    const state = tinyArena(['#######', '#0..1.#', '#######']);
    fx.push(
      [
        { tick: 10, kind: EventKind.DEATH, seat: 1, cell: cellIndex(4, 1), value: 0 },
        { tick: 10, kind: EventKind.BOMB_PLACED, seat: 0, cell: cellIndex(1, 1), value: 0 },
      ],
      state,
    );
    const f = fx.update(10 + DEATH_TICKS / 2);
    expect(f.deathProgress[1]).toBeCloseTo(0.5);
    expect(f.deathX[1]).toBe(4.5);
    expect(f.deathProgress[0]).toBe(-1);
    const p = fx.update(13);
    expect(p.pulseY[0]).toBeLessThan(1);
    expect(p.pulseX[0]).toBeGreaterThan(1);
    expect(fx.update(10 + DEATH_TICKS + 1).deathProgress[1]).toBe(-1);
    expect(fx.update(40).pulseY[0]).toBe(1);
  });

  it('a Puff crushed by a sudden-death block deflates when the block lands', () => {
    const fx = new Effects();
    const state = tinyArena(['#######', '#0....#', '#######']);
    const cell = cellIndex(1, 1);
    fx.push(
      [
        { tick: 10, kind: EventKind.BLOCK_DROPPED, seat: NO_OWNER, cell, value: 0 },
        { tick: 10, kind: EventKind.DEATH, seat: 0, cell, value: NO_OWNER },
      ],
      state,
    );
    expect(fx.update(10 + BLOCK_DROP_TICKS / 2).deathProgress[0]).toBe(0);
    expect(fx.update(10 + BLOCK_DROP_TICKS + DEATH_TICKS / 2).deathProgress[0]).toBeCloseTo(0.5);
    expect(fx.update(10 + BLOCK_DROP_TICKS + DEATH_TICKS + 1).deathProgress[0]).toBe(-1);
  });

  it('throws confetti for the round winner', () => {
    const fx = new Effects();
    const state = createState({
      seed: 2,
      arena: CLASSIC_ARENAS[1]!,
      seats: [true, true, false, false],
    });
    state.alive[1] = 0;
    state.hdr[Hdr.PHASE] = Phase.ROUND_OVER;
    fx.push([{ tick: 50, kind: EventKind.ROUND_END, seat: NO_OWNER, cell: -1, value: 0 }], state);
    const f = fx.update(60);
    expect(Array.from(f.kind.subarray(0, f.count)).every((k) => k === Fx.CONFETTI)).toBe(true);
    expect(f.count).toBeGreaterThan(10);
  });
});
