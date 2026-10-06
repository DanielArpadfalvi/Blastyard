/**
 * Scripted "demo" inputs for the dev / test arena view: every Puff runs the same small routine
 * from its corner, mirrored per spawn – step out of the safe L, drop a pop, hide around the
 * corner, wait for the blast, then walk one cell further along its row and repeat. It is a pure
 * function of the state (read only), so a seeded demo always plays out identically and the
 * renderer has bombs, flames, broken crates and pickups to show.
 */

import { Dir, GRID_W, Hdr, Phase, encodeInput, type Direction } from '../core';
import type { ReadonlySimState } from '../render/readonlyState';

/** Ticks to walk one tile at base speed (256 / 16). */
const STEP = 16;
/** Ticks from round start until the first cycle (after stepping into the hiding cell). */
const FIRST_CYCLE = STEP + 4;
/** Length of one bomb cycle: walk out, drop, flee, wait for the blast and the flames to clear. */
export const DEMO_CYCLE = 280;
/** Bomb cycles per round before the Puffs stay in their hiding cell. */
export const DEMO_CYCLES = 4;

function mirror(dir: Direction, mx: boolean, my: boolean): Direction {
  if (mx && dir === Dir.LEFT) return Dir.RIGHT;
  if (mx && dir === Dir.RIGHT) return Dir.LEFT;
  if (my && dir === Dir.UP) return Dir.DOWN;
  if (my && dir === Dir.DOWN) return Dir.UP;
  return dir;
}

/**
 * Routine in top-left coordinates for `t` ticks into cycle `k`: up out of the hiding cell (1, 2),
 * right k + 1 cells, pop, back left, down into hiding.
 */
function cycleInput(t: number, k: number): number {
  const reach = (k + 1) * STEP;
  if (t < STEP) return encodeInput(Dir.UP);
  if (t < STEP + reach) return encodeInput(Dir.RIGHT);
  const drop = STEP + reach;
  if (t === drop) return encodeInput(Dir.NONE, Dir.NONE, true);
  if (t <= drop + reach) return encodeInput(Dir.LEFT);
  if (t <= drop + reach + STEP) return encodeInput(Dir.DOWN);
  return encodeInput(Dir.NONE);
}

/** Demo input byte for `seat` in the current tick (0 outside the playing phase). */
export function demoInput(state: ReadonlySimState, seat: number): number {
  if ((state.hdr[Hdr.PHASE] as number) !== Phase.PLAYING) return 0;
  if ((state.alive[seat] as number) === 0) return 0;
  const roundTicks = state.hdr[Hdr.ROUND_TICKS] as number;
  const elapsed = roundTicks > 0 ? roundTicks - (state.hdr[Hdr.ROUND_TIME] as number) : 0;
  const spawn = state.spawnCell[seat] as number;
  const sx = spawn % GRID_W;
  const sy = (spawn - sx) / GRID_W;
  const mx = sx > GRID_W / 2;
  const my = sy > GRID_W / 2;
  let raw: number;
  if (elapsed < STEP) raw = encodeInput(Dir.DOWN);
  else if (elapsed < FIRST_CYCLE) raw = 0;
  else {
    const t = elapsed - FIRST_CYCLE;
    const k = Math.floor(t / DEMO_CYCLE);
    raw = k < DEMO_CYCLES ? cycleInput(t - k * DEMO_CYCLE, k) : 0;
  }
  const main = mirror((raw & 7) as Direction, mx, my);
  return encodeInput(main, Dir.NONE, (raw & 0x40) !== 0);
}
