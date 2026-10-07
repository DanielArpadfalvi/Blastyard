/**
 * Showcase scenes for the dev / test arena view (`?test&scene=…`): hand-arranged starting
 * situations for effect screenshots and, later, store frames (T9.2). They only set up the state
 * before the first frame; from then on the scene plays through `step` like any match.
 *
 * - `chain`: six pops along the middle row; the first one is about to go off and sets off the
 *   rest one after another (a chain reaction rippling across the arena, crates breaking above and
 *   below).
 * - `suddenDeath`: the round clock is about to run out; the spiral starts within a few ticks.
 */

import {
  GRID_W,
  Hdr,
  MAX_SEATS,
  Phase,
  Tile,
  addBomb,
  cellIndex,
  step,
  type SimState,
} from '../core';

export type ShowcaseId = 'chain' | 'suddenDeath';

export function parseShowcase(value: string | null): ShowcaseId | null {
  if (value === 'chain') return 'chain';
  if (value === 'suddenDeath' || value === 'suddendeath') return 'suddenDeath';
  return null;
}

/** Row and columns of the chain scene. */
export const CHAIN_ROW = 5;
export const CHAIN_COLUMNS: readonly number[] = [1, 3, 5, 7, 9, 11];
/** Fuse of the first pop of the chain (ticks). */
export const CHAIN_FIRST_FUSE = 20;
const CHAIN_RANGE = 2;

/** Ticks of round clock left in the sudden-death scene. */
export const SUDDEN_DEATH_LEAD = 2;

function skipCountdown(state: SimState): void {
  const idle = new Uint8Array(MAX_SEATS);
  while ((state.hdr[Hdr.PHASE] as number) === Phase.COUNTDOWN) step(state, idle);
}

/** Arranges `scene` on a freshly created match state (skips the countdown first). */
export function applyShowcase(state: SimState, scene: ShowcaseId): void {
  skipCountdown(state);
  if (scene === 'suddenDeath') {
    state.hdr[Hdr.ROUND_TIME] = SUDDEN_DEATH_LEAD;
    return;
  }
  // Clear the middle row (crates and their hidden pickups) and line it with pops.
  for (let x = 1; x < GRID_W - 1; x++) {
    const c = cellIndex(x, CHAIN_ROW);
    if ((state.tiles[c] as number) === Tile.CRATE) state.tiles[c] = Tile.FLOOR;
    state.hidden[c] = 0;
    state.pickup[c] = 0;
  }
  CHAIN_COLUMNS.forEach((x, i) => {
    if ((state.tiles[cellIndex(x, CHAIN_ROW)] as number) !== Tile.FLOOR) return;
    addBomb(state, x, CHAIN_ROW, i % MAX_SEATS, i === 0 ? CHAIN_FIRST_FUSE : 150, CHAIN_RANGE);
  });
}
