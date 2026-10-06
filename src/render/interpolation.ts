/**
 * Render interpolation between 60 Hz simulation ticks (PLAN §1.13).
 *
 * The game loop calls {@link TickHistory.capture} right before every `step`, so the history holds
 * the positions of the previous tick; the renderer then draws `lerp(previous, current, alpha)`
 * where `alpha` is the fraction of a tick the real-time clock is past the latest step. Moves
 * longer than one tile in a single tick (new round, ghost projection, bomb re-use of an index)
 * snap instead of sliding across the arena.
 */

import { Hdr, MAX_BOMBS, MAX_SEATS, TILE } from '../core';
import type { ReadonlySimState } from './readonlyState';

/** Positions further apart than this in one tick are teleports and are not interpolated. */
export const SNAP_DISTANCE = TILE;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates one subunit coordinate; snaps when the move is a teleport. */
export function interpolateCoord(prev: number, cur: number, alpha: number): number {
  if (Math.abs(cur - prev) > SNAP_DISTANCE) return cur;
  const t = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  return lerp(prev, cur, t);
}

/** Copy of the moving parts of the state as they were before the latest `step`. */
export class TickHistory {
  readonly px = new Int32Array(MAX_SEATS);
  readonly py = new Int32Array(MAX_SEATS);
  readonly bombX = new Int32Array(MAX_BOMBS);
  readonly bombY = new Int32Array(MAX_BOMBS);
  readonly bombOwner = new Uint8Array(MAX_BOMBS);
  bombCount = 0;
  /** Tick id of the captured state; -1 before the first capture. */
  tick = -1;

  /** Remembers `state` (read only) as the "previous tick". Allocation-free. */
  capture(state: ReadonlySimState): void {
    for (let s = 0; s < MAX_SEATS; s++) {
      this.px[s] = state.px[s] as number;
      this.py[s] = state.py[s] as number;
    }
    const n = state.hdr[Hdr.BOMB_COUNT] as number;
    for (let b = 0; b < n; b++) {
      this.bombX[b] = state.bombX[b] as number;
      this.bombY[b] = state.bombY[b] as number;
      this.bombOwner[b] = state.bombOwner[b] as number;
    }
    this.bombCount = n;
    this.tick = state.hdr[Hdr.TICK] as number;
  }

  /** True when the history is exactly one tick behind `state`. */
  isPreviousOf(state: ReadonlySimState): boolean {
    return this.tick >= 0 && this.tick === (state.hdr[Hdr.TICK] as number) - 1;
  }
}

/**
 * Interpolated position of bomb `b`: bombs are stored compacted, so an index only refers to the
 * same bomb across ticks when the previous tick had a bomb there with the same owner.
 */
export function bombPrevIndexValid(history: TickHistory, b: number, owner: number): boolean {
  return b < history.bombCount && history.bombOwner[b] === owner;
}
