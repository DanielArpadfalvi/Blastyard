/**
 * Subunit movement (1 tile = 256 subunits) with tile-axis turning and corner assist.
 *
 * Rules (per seat, per tick, budget = speed in subunits):
 * - A player only moves along an axis while centred on the other axis (invariant: always aligned
 *   on at least one axis). Its "tile" is the tile containing its centre.
 * - Moving towards a blocked neighbour tile (wall, pillar, crate, or a bomb the seat may not pass)
 *   stops at the centre of the current tile.
 * - Corner assist: when the requested direction is perpendicular to the current lane and the
 *   player is at most `CORNER_ASSIST` subunits from its tile centre, and the target lane is open,
 *   it first slides towards the centre and spends the leftover budget in the new direction.
 * - Fallbacks, in order, when the main direction yields no movement: the secondary direction
 *   (stick turn intent – lets a diagonal hold slide along a corridor until the opening), then the
 *   previous movement direction if it is perpendicular to the request (a turn pressed too early
 *   keeps the player running until the assist window catches the opening – the window is wider
 *   than the maximum speed, so no opening can be skipped).
 */

import { canPassBomb, bombAt } from './bombs';
import {
  DIR_DX,
  DIR_DY,
  Dir,
  inputMain,
  inputSecondary,
  isHorizontal,
  isPerpendicular,
  type Direction,
} from './input';
import { Tile, cellIndex, inBounds, tileCenter, toTile, type SimState } from './state';

/** Base speed in subunits per tick (3.75 tiles/s at 60 Hz). */
export const BASE_SPEED = 16;
/** Extra subunits per tick per Roller pickup. */
export const ROLLER_SPEED = 2;
/** Max Roller pickups that count (24 subunits/tick). */
export const MAX_SPEED_LEVEL = 4;
/** Corner assist window in subunits from the tile centre (37.5% of a tile). */
export const CORNER_ASSIST = 96;

export function playerSpeed(state: SimState, seat: number): number {
  const lvl = Math.min(state.speedLvl[seat] as number, MAX_SPEED_LEVEL);
  return BASE_SPEED + ROLLER_SPEED * lvl;
}

/** Can `seat` stand on tile (x, y)? */
export function isPassable(state: SimState, seat: number, x: number, y: number): boolean {
  if (!inBounds(x, y)) return false;
  if (state.tiles[cellIndex(x, y)] !== Tile.FLOOR) return false;
  const b = bombAt(state, x, y);
  return b < 0 || canPassBomb(state, b, seat);
}

/**
 * Moves `seat` along `dir` by up to `budget` subunits, assuming it is aligned on the other axis.
 * Returns the distance actually moved.
 */
function advance(state: SimState, seat: number, dir: Direction, budget: number): number {
  const horiz = isHorizontal(dir);
  const sign = dir === Dir.RIGHT || dir === Dir.DOWN ? 1 : -1;
  const pos = horiz ? (state.px[seat] as number) : (state.py[seat] as number);
  const tx = toTile(state.px[seat] as number);
  const ty = toTile(state.py[seat] as number);
  let target = pos + sign * budget;
  if (!isPassable(state, seat, tx + (DIR_DX[dir] as number), ty + (DIR_DY[dir] as number))) {
    // Only up to the centre of the current tile (never backwards if already past it).
    const center = tileCenter(horiz ? tx : ty);
    target =
      sign > 0 ? Math.min(target, Math.max(pos, center)) : Math.max(target, Math.min(pos, center));
  }
  if (horiz) state.px[seat] = target;
  else state.py[seat] = target;
  return Math.abs(target - pos);
}

/** Tries to move in `dir` (with corner assist). Returns true if the player moved. */
function tryDirection(state: SimState, seat: number, dir: Direction, budget: number): boolean {
  const horiz = isHorizontal(dir);
  const perpPos = horiz ? (state.py[seat] as number) : (state.px[seat] as number);
  const perpTile = toTile(perpPos);
  const off = perpPos - tileCenter(perpTile);
  if (off === 0) {
    if (advance(state, seat, dir, budget) === 0) return false;
    state.moveDir[seat] = dir;
    return true;
  }
  if (Math.abs(off) > CORNER_ASSIST) return false;
  const tx = toTile(state.px[seat] as number);
  const ty = toTile(state.py[seat] as number);
  if (!isPassable(state, seat, tx + (DIR_DX[dir] as number), ty + (DIR_DY[dir] as number))) {
    return false;
  }
  // Corner assist: slide to the lane centre first, then continue with the leftover budget.
  const slide = Math.min(budget, Math.abs(off));
  const next = perpPos - Math.sign(off) * slide;
  if (horiz) state.py[seat] = next;
  else state.px[seat] = next;
  if (budget > slide) advance(state, seat, dir, budget - slide);
  state.moveDir[seat] = dir;
  return true;
}

/** Moves one seat for one tick from its input byte. */
export function movePlayer(state: SimState, seat: number, input: number): void {
  const main = inputMain(input);
  if (main === Dir.NONE) {
    state.moveDir[seat] = Dir.NONE;
    return;
  }
  state.facing[seat] = main;
  const budget = playerSpeed(state, seat);
  if (tryDirection(state, seat, main, budget)) return;
  const secondary = inputSecondary(input);
  if (
    secondary !== Dir.NONE &&
    secondary !== main &&
    tryDirection(state, seat, secondary, budget)
  ) {
    return;
  }
  const prev = state.moveDir[seat] as Direction;
  if (
    isPerpendicular(prev, main) &&
    prev !== secondary &&
    tryDirection(state, seat, prev, budget)
  ) {
    return;
  }
  state.moveDir[seat] = Dir.NONE;
}
