/**
 * Placeholder "wander" bot for the first playable (T2.3); the real bot AI (danger map with chain
 * timing, goals, difficulties, own RNG stream inside `step`) replaces it in T4.2.
 *
 * `wanderInput(state, seat)` is a pure, read-only function of the state: it never writes to the
 * state or its RNG streams. Its randomness is an integer hash of the match seed, round, seat and
 * a coarse tick epoch, so the same state always yields the same input byte. The game feeds the
 * returned byte into `step` like any other seat input, which means the recorded input log alone
 * reproduces a match against the bot (replays work without the bot code).
 *
 * Behaviour, in priority order:
 *  1. Standing in a blast line or flame → walk (BFS) to the nearest cell no bomb can reach.
 *  2. Next to a crate at its wander destination, or an opponent in a clear blast line → place a
 *     pop, but only if an escape cell is reachable before the fuse runs out.
 *  3. Wander: every `WANDER_EPOCH` ticks it picks a random goal cell and walks, through cells no
 *     bomb threatens, to the reachable cell closest to it (often next to the crates in the way).
 * As a ghost it glides along the wall and drops a revenge pop whenever it may.
 */

import { bombAt, bombsInUse, FUSE_TICKS } from '../bombs';
import { DIR_DX, DIR_DY, Dir, encodeInput, type Direction } from '../input';
import { CORNER_ASSIST, isPassable, playerSpeed } from '../movement';
import {
  CELL_COUNT,
  GRID_H,
  GRID_W,
  Hdr,
  MAX_SEATS,
  Phase,
  TILE,
  Tile,
  cellIndex,
  isSeatActive,
  playerCell,
  sideOf,
  tileCenter,
  toTile,
  type SimState,
} from '../state';

/** Ticks between two wander goals. */
export const WANDER_EPOCH = 120;
/** Ticks of fuse kept in reserve when checking that a pop can be escaped. */
export const ESCAPE_MARGIN = 24;
/** The bot only drops a pop when this close (subunits) to its tile centre on both axes. */
const DROP_WINDOW = 48;
/** Off-centre distance (subunits) the bot accepts when standing still. */
const SETTLE_SLACK = 16;
/** Percent chance per (cell, epoch) to attack an opponent standing in a blast line. */
const ATTACK_PERCENT = 60;

/** Danger levels per cell. */
const SAFE = 0;
const THREATENED = 1;
const BURNING = 2;

// Module scratch (the function is synchronous and never re-entered).
const danger = new Uint8Array(CELL_COUNT);
const dangerWithPop = new Uint8Array(CELL_COUNT);
const dist = new Int16Array(CELL_COUNT);
const firstDir = new Uint8Array(CELL_COUNT);
const queue = new Int16Array(CELL_COUNT);

const DIRS: readonly Direction[] = [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT];

/** murmur3 finaliser over a few integers: the bot's stateless randomness. */
export function wanderHash(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  for (const v of [b, c, d]) {
    h = Math.imul(h ^ (v | 0), 0xcc9e2d51);
    h = (h << 15) | (h >>> 17);
    h = Math.imul(h, 0x1b873593);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Marks the cross a pop of `range` on (bx, by) would burn (same arm rules as `explode`). */
function markBlast(state: SimState, out: Uint8Array, bx: number, by: number, range: number): void {
  const center = cellIndex(bx, by);
  if ((out[center] as number) < THREATENED) out[center] = THREATENED;
  for (let arm = 0; arm < 4; arm++) {
    const dx = DIR_DX[DIRS[arm] as number] as number;
    const dy = DIR_DY[DIRS[arm] as number] as number;
    for (let r = 1; r <= range; r++) {
      const x = bx + dx * r;
      const y = by + dy * r;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) break;
      const cell = cellIndex(x, y);
      const tile = state.tiles[cell] as number;
      if (tile !== Tile.FLOOR) break;
      if ((out[cell] as number) < THREATENED) out[cell] = THREATENED;
      if (bombAt(state, x, y) >= 0) break;
    }
  }
}

/** Danger of every cell: burning flames and every live pop's blast cross. */
function computeDanger(state: SimState, out: Uint8Array): void {
  for (let c = 0; c < CELL_COUNT; c++) out[c] = (state.flame[c] as number) > 0 ? BURNING : SAFE;
  const n = state.hdr[Hdr.BOMB_COUNT] as number;
  for (let b = 0; b < n; b++) {
    const bx = toTile(state.bombX[b] as number);
    const by = toTile(state.bombY[b] as number);
    markBlast(state, out, bx, by, state.bombRange[b] as number);
  }
}

/**
 * Breadth-first search from `seat`'s cell over cells it may enter that are not burning (and, with
 * `safeOnly`, not threatened either). Fills `dist` (-1 = unreached) and `firstDir` (the first
 * step towards each cell). Neighbours are expanded up, right, down, left, so ties are stable.
 */
function search(state: SimState, seat: number, map: Uint8Array, safeOnly: boolean): number {
  dist.fill(-1);
  const start = playerCell(state, seat);
  dist[start] = 0;
  firstDir[start] = Dir.NONE;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cell = queue[head++] as number;
    const x = cell % GRID_W;
    const y = (cell - x) / GRID_W;
    for (const dir of DIRS) {
      const nx = x + (DIR_DX[dir] as number);
      const ny = y + (DIR_DY[dir] as number);
      if (!isPassable(state, seat, nx, ny)) continue;
      const next = cellIndex(nx, ny);
      if (dist[next] !== -1) continue;
      const level = map[next] as number;
      if (level === BURNING || (safeOnly && level !== SAFE)) continue;
      dist[next] = (dist[cell] as number) + 1;
      firstDir[next] = cell === start ? dir : (firstDir[cell] as number);
      queue[tail++] = next;
    }
  }
  return start;
}

/** Nearest reached cell with `map[cell] === SAFE` within `maxSteps`, or -1 (needs `search`). */
function nearestSafe(map: Uint8Array, maxSteps: number): number {
  let best = -1;
  for (let c = 0; c < CELL_COUNT; c++) {
    const d = dist[c] as number;
    if (d < 0 || d > maxSteps || map[c] !== SAFE) continue;
    if (best < 0 || d < (dist[best] as number)) best = c;
  }
  return best;
}

/** Is there an opponent (other side, alive) in a clear blast line of length `range`? */
function opponentInLine(state: SimState, seat: number, range: number): boolean {
  const cell = playerCell(state, seat);
  const bx = cell % GRID_W;
  const by = (cell - bx) / GRID_W;
  const side = sideOf(state, seat);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (s === seat || !isSeatActive(state, s) || !state.alive[s]) continue;
    if (sideOf(state, s) === side) continue;
    const target = playerCell(state, s);
    const tx = target % GRID_W;
    const ty = (target - tx) / GRID_W;
    if (tx !== bx && ty !== by) continue;
    const span = Math.abs(tx - bx) + Math.abs(ty - by);
    if (span === 0 || span > range) continue;
    const sx = Math.sign(tx - bx);
    const sy = Math.sign(ty - by);
    let clear = true;
    for (let r = 1; r < span && clear; r++) {
      clear = state.tiles[cellIndex(bx + sx * r, by + sy * r)] === Tile.FLOOR;
    }
    if (clear) return true;
  }
  return false;
}

/** A crate right next to the seat's cell? */
function crateAdjacent(state: SimState, cell: number): boolean {
  const x = cell % GRID_W;
  const y = (cell - x) / GRID_W;
  for (const dir of DIRS) {
    const nx = x + (DIR_DX[dir] as number);
    const ny = y + (DIR_DY[dir] as number);
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
    if (state.tiles[cellIndex(nx, ny)] === Tile.CRATE) return true;
  }
  return false;
}

/** Would a pop dropped right now leave an escape cell reachable before it goes off? */
function canEscapeOwnPop(state: SimState, seat: number, cell: number): boolean {
  dangerWithPop.set(danger);
  const x = cell % GRID_W;
  markBlast(state, dangerWithPop, x, (cell - x) / GRID_W, state.range[seat] as number);
  search(state, seat, dangerWithPop, false);
  const ticksPerTile = Math.ceil(TILE / playerSpeed(state, seat));
  const maxSteps = Math.floor((FUSE_TICKS - ESCAPE_MARGIN) / ticksPerTile);
  return nearestSafe(dangerWithPop, maxSteps) >= 0;
}

/** Ghost: glide one way along the wall per epoch, drop a revenge pop on every chance. */
function ghostInput(state: SimState, seat: number, seed: number, tick: number): number {
  const r = wanderHash(seed, seat, state.hdr[Hdr.ROUND] as number, Math.floor(tick / 90));
  const dir = DIRS[r % 4] as Direction;
  const other = DIRS[(r >>> 8) % 4] as Direction;
  return encodeInput(dir, other, (state.ghostCd[seat] as number) === 0 && (r >>> 16) % 4 === 0);
}

/** Input byte for bot `seat` this tick. Never mutates `state`. */
export function wanderInput(state: SimState, seat: number): number {
  const hdr = state.hdr;
  if (hdr[Hdr.PHASE] !== Phase.PLAYING || !isSeatActive(state, seat)) return 0;
  const seed = hdr[Hdr.SEED] as number;
  const tick = hdr[Hdr.TICK] as number;
  if (!state.alive[seat]) return state.ghost[seat] ? ghostInput(state, seat, seed, tick) : 0;

  computeDanger(state, danger);
  const cell = search(state, seat, danger, false);

  // 1. Escape.
  if (danger[cell] !== SAFE) {
    const target = nearestSafe(danger, CELL_COUNT);
    const px = state.px[seat] as number;
    const py = state.py[seat] as number;
    const flee = target >= 0 ? (firstDir[target] as Direction) : Dir.NONE;
    return steer(flee, tileCenter(toTile(px)) - px, tileCenter(toTile(py)) - py);
  }

  // Wander destination: the reachable, unthreatened cell closest to this epoch's goal.
  const round = hdr[Hdr.ROUND] as number;
  const epoch = Math.floor(tick / WANDER_EPOCH);
  const roll = wanderHash(seed, seat, round, epoch);
  const goal = roll % ((GRID_W - 2) * (GRID_H - 2));
  const gx = 1 + (goal % (GRID_W - 2));
  const gy = 1 + Math.floor(goal / (GRID_W - 2));
  search(state, seat, danger, true);
  let dest = cell;
  let destScore = Number.MAX_SAFE_INTEGER;
  for (let c = 0; c < CELL_COUNT; c++) {
    const d = dist[c] as number;
    if (d < 0) continue;
    const x = c % GRID_W;
    const y = (c - x) / GRID_W;
    // Closest to the goal first, then the nearer one to walk to.
    const score = (Math.abs(x - gx) + Math.abs(y - gy)) * 256 + d;
    if (score < destScore) {
      destScore = score;
      dest = c;
    }
  }
  const px = state.px[seat] as number;
  const py = state.py[seat] as number;
  const dx = tileCenter(toTile(px)) - px;
  const dy = tileCenter(toTile(py)) - py;
  // At the destination: settle on the tile centre (an idle input would stop right on the edge).
  // Within SETTLE_SLACK it stays put (a Roller speed would overshoot the centre back and forth).
  const settle =
    dx > SETTLE_SLACK
      ? Dir.RIGHT
      : dx < -SETTLE_SLACK
        ? Dir.LEFT
        : dy > SETTLE_SLACK
          ? Dir.DOWN
          : dy < -SETTLE_SLACK
            ? Dir.UP
            : Dir.NONE;
  const move = dest === cell ? settle : (firstDir[dest] as Direction);

  // 2. Pop: next to a crate at the destination, or an opponent in line (sometimes).
  const centred = Math.abs(dx) <= DROP_WINDOW && Math.abs(dy) <= DROP_WINDOW;
  if (
    centred &&
    bombsInUse(state, seat) < (state.bombCap[seat] as number) &&
    bombAt(state, cell % GRID_W, (cell - (cell % GRID_W)) / GRID_W) < 0
  ) {
    const attack =
      opponentInLine(state, seat, state.range[seat] as number) &&
      wanderHash(seed ^ 0x5bd1e995, seat, cell, epoch) % 100 < ATTACK_PERCENT;
    const dig = dest === cell && crateAdjacent(state, cell);
    if ((attack || dig) && canEscapeOwnPop(state, seat, cell)) {
      return encodeInput(Dir.NONE, Dir.NONE, true);
    }
  }
  return steer(move, dx, dy);
}

/**
 * Input for walking in `move` from an off-centre position (`dx`, `dy` = subunits to the tile
 * centre): a turn the corner assist cannot take yet first walks towards the centre, keeping the
 * turn as the secondary direction (a bot halted on a tile edge would otherwise stay stuck).
 */
function steer(move: Direction, dx: number, dy: number): number {
  if (move === Dir.NONE) return 0;
  const horizontal = move === Dir.LEFT || move === Dir.RIGHT;
  const off = horizontal ? dy : dx;
  if (Math.abs(off) <= CORNER_ASSIST) return encodeInput(move);
  const settle = horizontal ? (off > 0 ? Dir.DOWN : Dir.UP) : off > 0 ? Dir.RIGHT : Dir.LEFT;
  return encodeInput(settle, move);
}
