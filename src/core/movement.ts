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

import { bombAt, canPassBomb, kickBomb } from './bombs';
import type { EventSink } from './events';
import { ICE_SLIDE } from './floorFx';
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
import {
  Ability,
  FloorFx,
  Hdr,
  Jinx,
  RuleFlag,
  Tile,
  cellIndex,
  inBounds,
  playerCell,
  tileCenter,
  toTile,
  type SimState,
} from './state';

/** Base speed in subunits per tick (3.75 tiles/s at 60 Hz). */
export const BASE_SPEED = 16;
/** Extra subunits per tick per Roller pickup. */
export const ROLLER_SPEED = 2;
/** Max Roller pickups that count (24 subunits/tick). */
export const MAX_SPEED_LEVEL = 4;
/** Corner assist window in subunits from the tile centre (37.5% of a tile). */
export const CORNER_ASSIST = 96;
/** Assist windows of the weaker / stronger setting (`RuleFlag.ASSIST_LOW` / `ASSIST_HIGH`). */
export const CORNER_ASSIST_LOW = 48;
export const CORNER_ASSIST_HIGH = 120;

/** The match's corner-assist window. */
export function cornerAssist(state: SimState): number {
  const flags = state.hdr[Hdr.RULE_FLAGS] as number;
  if ((flags & RuleFlag.ASSIST_LOW) !== 0) return CORNER_ASSIST_LOW;
  if ((flags & RuleFlag.ASSIST_HIGH) !== 0) return CORNER_ASSIST_HIGH;
  return CORNER_ASSIST;
}

export function playerSpeed(state: SimState, seat: number): number {
  const lvl = Math.min(state.speedLvl[seat] as number, MAX_SPEED_LEVEL);
  const speed = BASE_SPEED + ROLLER_SPEED * lvl;
  return state.jinx[seat] === Jinx.SLOW ? speed >> 1 : speed;
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
function advance(
  state: SimState,
  seat: number,
  dir: Direction,
  budget: number,
  sink?: EventSink,
  allowKick = true,
): number {
  const horiz = isHorizontal(dir);
  const sign = dir === Dir.RIGHT || dir === Dir.DOWN ? 1 : -1;
  const pos = horiz ? (state.px[seat] as number) : (state.py[seat] as number);
  const tx = toTile(state.px[seat] as number);
  const ty = toTile(state.py[seat] as number);
  let target = pos + sign * budget;
  const nx = tx + (DIR_DX[dir] as number);
  const ny = ty + (DIR_DY[dir] as number);
  if (!isPassable(state, seat, nx, ny)) {
    // Only up to the centre of the current tile (never backwards if already past it).
    const center = tileCenter(horiz ? tx : ty);
    target =
      sign > 0 ? Math.min(target, Math.max(pos, center)) : Math.max(target, Math.min(pos, center));
    // Kick: standing at the centre, pushing against a resting bomb sets it sliding.
    if (
      allowKick &&
      target === center &&
      ((state.abilities[seat] as number) & Ability.KICK) !== 0
    ) {
      const b = bombAt(state, nx, ny);
      if (b >= 0) kickBomb(state, b, dir, seat, sink);
    }
  }
  if (horiz) state.px[seat] = target;
  else state.py[seat] = target;
  return Math.abs(target - pos);
}

/** Tries to move in `dir` (with corner assist). Returns true if the player moved. */
function tryDirection(
  state: SimState,
  seat: number,
  dir: Direction,
  budget: number,
  sink?: EventSink,
): boolean {
  const horiz = isHorizontal(dir);
  const perpPos = horiz ? (state.py[seat] as number) : (state.px[seat] as number);
  const perpTile = toTile(perpPos);
  const off = perpPos - tileCenter(perpTile);
  if (off === 0) {
    if (advance(state, seat, dir, budget, sink) === 0) return false;
    state.moveDir[seat] = dir;
    return true;
  }
  if (Math.abs(off) > cornerAssist(state)) return false;
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
  if (budget > slide) advance(state, seat, dir, budget - slide, sink);
  state.moveDir[seat] = dir;
  return true;
}

/** Carries `seat` along a conveyor belt; only while it is centred across the belt. */
export function conveyPlayer(state: SimState, seat: number, dir: Direction, budget: number): void {
  const horiz = isHorizontal(dir);
  const perp = horiz ? (state.py[seat] as number) : (state.px[seat] as number);
  if (perp !== tileCenter(toTile(perp))) return;
  advance(state, seat, dir, budget, undefined, false);
}

function onIce(state: SimState, seat: number): boolean {
  return state.floor[playerCell(state, seat)] === FloorFx.ICE;
}

/** Ice: keeps gliding (up to `ICE_SLIDE` subunits in total) after the player let go. */
function glide(state: SimState, seat: number): void {
  const left = state.slideLeft[seat] as number;
  if (left === 0) return;
  const dir = state.slideDir[seat] as Direction;
  if (!onIce(state, seat)) {
    state.slideLeft[seat] = 0;
    return;
  }
  const want = Math.min(left, playerSpeed(state, seat));
  const moved = advance(state, seat, dir, want, undefined, false);
  state.slideLeft[seat] = moved < want ? 0 : left - moved;
  state.moveDir[seat] = moved > 0 ? dir : Dir.NONE;
}

/** Moves one seat for one tick from its input byte. */
export function movePlayer(state: SimState, seat: number, input: number, sink?: EventSink): void {
  if (!moveByInput(state, seat, input, sink)) {
    if (inputMain(input) === Dir.NONE) glide(state, seat);
    else state.slideLeft[seat] = 0;
    return;
  }
  const dir = state.moveDir[seat] as Direction;
  if (onIce(state, seat)) {
    state.slideLeft[seat] = ICE_SLIDE;
    state.slideDir[seat] = dir;
  } else {
    state.slideLeft[seat] = 0;
  }
}

/** Input-driven movement of one tick. Returns true when the seat moved. */
function moveByInput(state: SimState, seat: number, input: number, sink?: EventSink): boolean {
  const main = inputMain(input);
  if (main === Dir.NONE) {
    state.moveDir[seat] = Dir.NONE;
    return false;
  }
  state.facing[seat] = main;
  const budget = playerSpeed(state, seat);
  if (tryDirection(state, seat, main, budget, sink)) return true;
  const secondary = inputSecondary(input);
  if (
    secondary !== Dir.NONE &&
    secondary !== main &&
    tryDirection(state, seat, secondary, budget, sink)
  ) {
    return true;
  }
  const prev = state.moveDir[seat] as Direction;
  if (
    isPerpendicular(prev, main) &&
    prev !== secondary &&
    tryDirection(state, seat, prev, budget, sink)
  ) {
    return true;
  }
  state.moveDir[seat] = Dir.NONE;
  return false;
}
