/**
 * Bot perception: the danger map and the time-aware breadth-first search (PLAN §1.10).
 *
 * `computeDanger` fills, for every cell, the tick window in which it burns: `dStart` (ticks from
 * now until the first flame arrives, `SAFE` = never) and `dEnd` (until the last flame there has
 * died out). Sources are lingering flames (window [0, remaining]), every live bomb's blast cross
 * (stopped by walls, pillars, crates and bombs exactly like `explode`, piercing crates for Pierce
 * bombs) and – with `chain` – the chain reaction: a bomb reached by another bomb's blast goes off
 * `CHAIN_DELAY` ticks after it, which is propagated until the explosion times settle. Kicked bombs
 * are projected to the tile where they will come to rest. The next sudden-death blocks are
 * windows that never end. A hypothetical extra bomb can be added to evaluate a placement.
 *
 * `search` is a breadth-first search over the cells a seat may enter, where a cell is blocked when
 * the seat's stay on it (from half a tile before its centre to half a tile after) overlaps its
 * burning window.
 *
 * All buffers are module scratch: the functions are synchronous and never re-entered.
 */

import { CHAIN_DELAY, FLAME_TICKS, FUSE_TICKS, bombCanEnter, canPassBomb } from '../bombs';
import { DIR_DX, DIR_DY } from '../input';
import { SD_INTERVAL, SPIRAL } from '../round';
import {
  CELL_COUNT,
  GRID_H,
  GRID_W,
  Hdr,
  MAX_BOMBS,
  RuleFlag,
  Tile,
  cellIndex,
  toTile,
  type SimState,
} from '../state';

/** `dStart` of a cell that never burns. */
export const SAFE = 30000;
/** Window end of a cell that stays lethal for good (sudden-death walls). */
const FOREVER = 30000;
/** Ticks of margin before a burn window within which a cell counts as already burning. */
const LEAD = 2;
/** Sudden-death slots looked ahead, and how many ticks ahead a falling block counts as danger. */
const SD_LOOKAHEAD = 24;
const SD_HORIZON = 120;

export const dStart = new Int16Array(CELL_COUNT);
export const dEnd = new Int16Array(CELL_COUNT);
/** Like `dStart`, but only from the asking seat's own bombs (and hypothetical bomb). */
export const dOwn = new Int16Array(CELL_COUNT);
/** Index (in the bomb table) of the bomb on each cell, -1 = none. Includes hypothetical bombs. */
export const bombGrid = new Int8Array(CELL_COUNT);

const bombTime = new Int16Array(MAX_BOMBS + 1);
const bombCell = new Int16Array(MAX_BOMBS + 1);
const bombReach = new Uint8Array(MAX_BOMBS + 1);
const bombPierce = new Uint8Array(MAX_BOMBS + 1);
const bombHidden = new Uint8Array(MAX_BOMBS + 1);
const bombMine = new Uint8Array(MAX_BOMBS + 1);

/** Neighbour cell per (cell, direction index 0–3 = up, right, down, left), -1 outside the grid. */
export const NEIGHBOR: Int16Array = (() => {
  const out = new Int16Array(CELL_COUNT * 4).fill(-1);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      for (let i = 0; i < 4; i++) {
        const nx = x + (DIR_DX[i + 1] as number);
        const ny = y + (DIR_DY[i + 1] as number);
        if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H) {
          out[cellIndex(x, y) * 4 + i] = cellIndex(nx, ny);
        }
      }
    }
  }
  return out;
})();

function mark(cell: number, time: number, mine = false): void {
  if (time < (dStart[cell] as number)) dStart[cell] = time;
  if (mine && time < (dOwn[cell] as number)) dOwn[cell] = time;
  const end = time + FLAME_TICKS;
  if (end > (dEnd[cell] as number)) dEnd[cell] = end;
}

/**
 * Walks bomb `b`'s blast cross. With `write` false it propagates the chain reaction (returns true
 * when some bomb's time dropped); with `write` true it marks the burn windows.
 */
function walk(state: SimState, b: number, write: boolean): boolean {
  const time = bombTime[b] as number;
  const origin = bombCell[b] as number;
  const reach = bombReach[b] as number;
  const pierce = bombPierce[b] !== 0;
  let changed = false;
  const mine = bombMine[b] !== 0;
  if (write) mark(origin, time, mine);
  for (let i = 0; i < 4; i++) {
    let cell = origin;
    for (let r = 1; r <= reach; r++) {
      cell = NEIGHBOR[cell * 4 + i] as number;
      if (cell < 0) break;
      const tile = state.tiles[cell] as number;
      if (tile === Tile.WALL || tile === Tile.PILLAR) break;
      if (tile === Tile.CRATE) {
        if (!pierce) break;
        if (write) mark(cell, time, mine);
        continue;
      }
      if (write) mark(cell, time, mine);
      const other = bombGrid[cell] as number;
      if (other >= 0) {
        if (!write && other !== b && time + CHAIN_DELAY < (bombTime[other] as number)) {
          bombTime[other] = time + CHAIN_DELAY;
          changed = true;
        }
        break;
      }
    }
  }
  return changed;
}

/** Tile where a bomb sliding from (x, y) in `dir` comes to rest. */
function restingCell(state: SimState, x: number, y: number, dir: number): number {
  const dx = DIR_DX[dir] as number;
  const dy = DIR_DY[dir] as number;
  let cx = x;
  let cy = y;
  while (bombCanEnter(state, cx + dx, cy + dy)) {
    cx += dx;
    cy += dy;
  }
  return cellIndex(cx, cy);
}

/**
 * Computes the danger windows for `seat`'s view of the field. `reaction` hides other seats' bombs
 * younger than that many ticks; `chain` enables chain-reaction propagation. A hypothetical bomb on
 * `extraCell` (range `extraRange`) is included when `extraCell >= 0`.
 */
export function computeDanger(
  state: SimState,
  seat: number,
  reaction: number,
  chain: boolean,
  extraCell = -1,
  extraRange = 0,
  extraPierce = false,
): void {
  dStart.fill(SAFE);
  dOwn.fill(SAFE);
  dEnd.fill(0);
  bombGrid.fill(-1);
  const flame = state.flame;
  for (let c = 0; c < CELL_COUNT; c++) {
    const f = flame[c] as number;
    if (f > 0) {
      dStart[c] = 0;
      dEnd[c] = f;
    }
  }

  const n = state.hdr[Hdr.BOMB_COUNT] as number;
  let m = 0;
  for (let b = 0; b < n; b++) {
    const slide = state.bombSlide[b] as number;
    const x = toTile(state.bombX[b] as number);
    const y = toTile(state.bombY[b] as number);
    const fuse = state.bombFuse[b] as number;
    let cell = cellIndex(x, y);
    if (slide !== 0) {
      const rest = restingCell(state, x, y, slide);
      // The lane the bomb travels is lethal to stand in while it moves.
      const dx = DIR_DX[slide] as number;
      const dy = DIR_DY[slide] as number;
      let lx = x;
      let ly = y;
      while (cellIndex(lx, ly) !== rest) {
        mark(cellIndex(lx, ly), 0);
        lx += dx;
        ly += dy;
      }
      cell = rest;
    }
    bombCell[m] = cell;
    bombTime[m] = fuse > 0 ? fuse : 1;
    bombReach[m] = state.bombRange[b] as number;
    bombPierce[m] = 0;
    // Bombs of others that have only just been dropped are not noticed yet.
    bombHidden[m] =
      state.bombOwner[b] !== seat && reaction > 0 && fuse > FUSE_TICKS - reaction ? 1 : 0;
    bombMine[m] = state.bombOwner[b] === seat ? 1 : 0;
    bombGrid[cell] = m;
    m++;
  }
  // Pierce flags sit in the bomb table, not in the projection order: m === n here (one-to-one).
  for (let b = 0; b < n; b++) {
    bombPierce[b] = ((state.bombFlags[b] as number) & 4) !== 0 ? 1 : 0;
  }
  if (extraCell >= 0 && m < MAX_BOMBS && bombGrid[extraCell] === -1) {
    bombCell[m] = extraCell;
    bombTime[m] = FUSE_TICKS;
    bombReach[m] = extraRange;
    bombPierce[m] = extraPierce ? 1 : 0;
    bombHidden[m] = 0;
    bombMine[m] = 1;
    bombGrid[extraCell] = m;
    m++;
  }

  if (chain) {
    for (let pass = 0; pass <= m; pass++) {
      let changed = false;
      for (let b = 0; b < m; b++) if (walk(state, b, false)) changed = true;
      if (!changed) break;
    }
  }
  for (let b = 0; b < m; b++) if (bombHidden[b] === 0) walk(state, b, true);

  suddenDeath(state);
}

/** The next closing-spiral blocks as endless windows. */
function suddenDeath(state: SimState): void {
  const hdr = state.hdr;
  if (((hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.SUDDEN_DEATH) === 0) return;
  if ((hdr[Hdr.ROUND_TICKS] as number) <= 0) return;
  let index = hdr[Hdr.SD_INDEX] as number;
  let t: number;
  const timer = hdr[Hdr.SD_TIMER] as number;
  if (timer > 0) {
    t = timer;
  } else if ((hdr[Hdr.ROUND_TIME] as number) > 0 && (hdr[Hdr.ROUND_TIME] as number) <= 300) {
    t = (hdr[Hdr.ROUND_TIME] as number) + SD_INTERVAL;
    index = 0;
  } else {
    return;
  }
  for (let k = 0; k < SD_LOOKAHEAD && index + k < SPIRAL.length; k++) {
    const cell = SPIRAL[index + k] as number;
    const at = t + k * SD_INTERVAL;
    if (at > SD_HORIZON) break;
    if (at < (dStart[cell] as number)) dStart[cell] = at;
    dEnd[cell] = FOREVER;
  }
}

// ---------------------------------------------------------------------------------------------
// Search

export const dist = new Int16Array(CELL_COUNT);
/** First step (`Dir`) from the search origin towards each reached cell. */
export const firstDir = new Uint8Array(CELL_COUNT);
const queue = new Int16Array(CELL_COUNT);
/** Cells in the order they were reached by the last `search` (including the origin). */
export const reached = new Int16Array(CELL_COUNT);
export let reachedCount = 0;

/**
 * Breadth-first search from `start` for `seat`, `ticksPerTile` ticks per step. A cell is entered
 * only when it is floor, holds no bomb the seat cannot walk through, and the arrival tick lies
 * outside the cell's burn window (`strictOwn`: cells burnt by the seat's own bombs are closed as well). Fills `dist` (-1 = unreached), `firstDir` and `reached`.
 */
export function search(
  state: SimState,
  seat: number,
  start: number,
  ticksPerTile: number,
  maxSteps = 40,
  strictOwn = false,
): void {
  dist.fill(-1);
  dist[start] = 0;
  firstDir[start] = 0;
  queue[0] = start;
  reached[0] = start;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cell = queue[head++] as number;
    const d = dist[cell] as number;
    if (d >= maxSteps) continue;
    // The seat occupies the next tile from half a tile before its centre to half a tile after.
    const time = (d + 1) * ticksPerTile;
    const tin = time - (ticksPerTile >> 1);
    const tout = time + (ticksPerTile >> 1);
    for (let i = 0; i < 4; i++) {
      const next = NEIGHBOR[cell * 4 + i] as number;
      if (next < 0 || (dist[next] as number) >= 0) continue;
      if (state.tiles[next] !== Tile.FLOOR) continue;
      const g = bombGrid[next] as number;
      if (g >= 0 && !canPassBomb(state, g, seat)) continue;
      // Goal walking never enters a cell that the bot's own bomb is about to burn (it would
      // have to turn back at once).
      if (strictOwn && (dOwn[next] as number) !== SAFE) continue;
      const ds = dStart[next] as number;
      if (ds !== SAFE && tout >= ds - LEAD && tin <= (dEnd[next] as number) + 1) continue;
      dist[next] = d + 1;
      firstDir[next] = cell === start ? i + 1 : (firstDir[cell] as number);
      queue[tail] = next;
      reached[tail] = next;
      tail++;
    }
  }
  reachedCount = tail;
}

/** Number of cells reached by the last `search`. */
export function reachedCells(): number {
  return reachedCount;
}
