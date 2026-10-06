import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  Dir,
  Hdr,
  MAX_SEATS,
  SIM_VERSION,
  STATE_BYTES,
  addBomb,
  cloneState,
  createEmptyState,
  createState,
  encodeInput,
  restore,
  snapshot,
  snapshotInto,
  stateHash,
  step,
  type Direction,
  type SimState,
} from '../../../src/core';
import { ARENA_GARDEN } from '../../../src/content/arenas/classic';

const ALL_SEATS = [true, true, true, true];
const DIRS = [Dir.NONE, Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT] as const;

/** Deterministic scripted inputs: a cheap LCG over (tick, seat), no RNG state involved. */
function scriptedInputs(tick: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < MAX_SEATS; s++) {
    const h = (Math.imul(tick >> 4, 2654435761) + s * 97) >>> 0;
    out.push(encodeInput(DIRS[h % 5] as Direction, DIRS[(h >>> 8) % 5] as Direction));
  }
  return out;
}

function run(state: SimState, from: number, to: number): void {
  for (let t = from; t < to; t++) step(state, scriptedInputs(t));
}

describe('state model', () => {
  it('fits a 4-player snapshot into 4 KB', () => {
    const state = createState({ seed: 1, arena: ARENA_GARDEN, seats: ALL_SEATS });
    expect(STATE_BYTES).toBeLessThanOrEqual(4096);
    expect(snapshot(state).byteLength).toBe(STATE_BYTES);
    expect(snapshot(state).byteLength).toBeLessThanOrEqual(4096);
  });

  it('uses only integer typed arrays (no floats in state)', () => {
    const state = createState({ seed: 2, arena: ARENA_GARDEN, seats: ALL_SEATS });
    run(state, 0, 300);
    for (const [key, value] of Object.entries(state)) {
      if (key === 'buffer') continue;
      expect(value instanceof Float32Array || value instanceof Float64Array, key).toBe(false);
      expect(ArrayBuffer.isView(value), key).toBe(true);
      for (const v of Array.from(value as ArrayLike<number>))
        expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('stamps SIM_VERSION and starts at tick 0', () => {
    const state = createEmptyState();
    expect(state.hdr[Hdr.VERSION]).toBe(SIM_VERSION);
    expect(state.hdr[Hdr.TICK]).toBe(0);
    expect(state.tiles.length).toBe(CELL_COUNT);
  });

  it('restore → step gives the same hash as the uninterrupted run', () => {
    const straight = createState({ seed: 42, arena: ARENA_GARDEN, seats: ALL_SEATS });
    const resumed = createState({ seed: 42, arena: ARENA_GARDEN, seats: ALL_SEATS });
    addBomb(straight, 1, 1, 0, 150, 2);
    addBomb(resumed, 1, 1, 0, 150, 2);

    run(straight, 0, 240);
    run(resumed, 0, 240);
    const snap = snapshot(resumed);
    run(resumed, 240, 300); // diverge the live state, then roll back
    restore(resumed, snap);
    run(resumed, 240, 600);
    run(straight, 240, 600);

    expect(stateHash(resumed)).toBe(stateHash(straight));
    expect(resumed.hdr[Hdr.TICK]).toBe(600);

    // Restoring into a brand-new state object works too.
    const fresh = createEmptyState();
    restore(fresh, snap);
    run(fresh, 240, 600);
    expect(stateHash(fresh)).toBe(stateHash(straight));
  });

  it('snapshots are independent copies; snapshotInto reuses a buffer', () => {
    const state = createState({ seed: 3, arena: ARENA_GARDEN, seats: ALL_SEATS });
    const snap = snapshot(state);
    const before = stateHash(state);
    run(state, 0, 30);
    expect(stateHash(state)).not.toBe(before);
    const ring = new Uint8Array(STATE_BYTES);
    snapshotInto(state, ring);
    expect(ring).toEqual(state.bytes);
    restore(state, snap);
    expect(stateHash(state)).toBe(before);
    expect(() => snapshotInto(state, new Uint8Array(10))).toThrow(RangeError);
  });

  it('cloneState is deep', () => {
    const state = createState({ seed: 4, arena: ARENA_GARDEN, seats: ALL_SEATS });
    const copy = cloneState(state);
    expect(stateHash(copy)).toBe(stateHash(state));
    run(copy, 0, 10);
    expect(stateHash(copy)).not.toBe(stateHash(state));
  });

  it('rejects snapshots of the wrong size or version', () => {
    const state = createEmptyState();
    expect(() => restore(state, new Uint8Array(STATE_BYTES - 1))).toThrow(RangeError);
    const bad = snapshot(state);
    bad[0] = (SIM_VERSION + 1) & 0xff;
    expect(() => restore(state, bad)).toThrow(/SIM_VERSION/);
  });

  it('hash covers RNG streams', () => {
    const a = createState({ seed: 5, arena: ARENA_GARDEN, seats: ALL_SEATS });
    const b = cloneState(a);
    b.rng[0] = ((b.rng[0] as number) + 1) >>> 0;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('step is deterministic across identical runs', () => {
    const a = createState({ seed: 77, arena: ARENA_GARDEN, seats: ALL_SEATS });
    const b = createState({ seed: 77, arena: ARENA_GARDEN, seats: ALL_SEATS });
    run(a, 0, 500);
    run(b, 0, 500);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(step(a, [0, 0, 0, 0])).toEqual([]);
  });
});
