/**
 * Challenge monsters (PLAN §1.7): small deterministic creatures that live inside the simulation
 * (own RNG stream `RngStream.MONSTER`), so a challenge replay with monsters is reproduced by its
 * setup and the human input log alone.
 *
 * A monster rests on a tile, then walks to a neighbouring tile in `span` ticks (`monTimer` counts
 * down to its arrival); it counts as standing on the tile it left during the first half of the
 * step and on the tile it walks to during the second half ({@link monsterCell}). It walks on
 * floor tiles without bombs and never onto another monster's tile.
 *
 * - Snail: random walk (never turns back unless it must), one tile per 40 ticks (1.5 tiles/s).
 * - Hound: when a seat is at most `HOUND_SIGHT` steps away along walkable tiles it takes the
 *   first step of the shortest path to the nearest one; otherwise it wanders. One tile per 20
 *   ticks (3 tiles/s).
 * - Hopper: wanders (one tile per 30 ticks) and every `HOP_INTERVAL` ticks hops over an adjacent
 *   crate or pillar onto the free floor tile behind it (`HOP_TICKS`).
 *
 * Flames kill monsters (also a falling sudden-death block); a seat sharing a monster's tile is
 * eliminated (a Shield absorbs the hit). `RuleFlag.HARMLESS` (warm-up) disarms the monsters.
 */

import { bombAt } from './bombs';
import { EventKind, type EventSink } from './events';
import { DIR_DX, DIR_DY, Dir } from './input';
import { RngStream, randInt } from './rng';
import { SHIELD_INVULN } from './powerups';
import { eliminate } from './round';
import {
  Ability,
  GRID_H,
  GRID_W,
  Hdr,
  MAX_MONSTERS,
  MAX_SEATS,
  MONSTER_KILLER,
  Monster,
  NO_OWNER,
  RuleFlag,
  Tile,
  cellIndex,
  inBounds,
  isSeatActive,
  playerCell,
  type SimState,
} from './state';

/** Ticks per tile step, indexed by `Monster` kind. */
export const MONSTER_STEP_TICKS: readonly number[] = [0, 40, 20, 30];
/** Hopper: ticks between two hops, and the length of a hop. */
export const HOP_INTERVAL = 180;
export const HOP_TICKS = 36;
/** Hound: longest path (in steps) at which it notices a seat. */
export const HOUND_SIGHT = 5;
/** Ticks a monster rests before its first step (plus a small stagger per slot). */
export const MONSTER_START_DELAY = 60;

/** Where a challenge puts a monster. */
export interface MonsterSpawn {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
}

/** Puts the monsters onto their tiles (slot order). Called by `createState`. */
export function placeMonsters(state: SimState, spawns: readonly MonsterSpawn[]): void {
  if (spawns.length > MAX_MONSTERS) throw new RangeError(`at most ${MAX_MONSTERS} monsters`);
  spawns.forEach((m, i) => {
    if (m.kind < Monster.SNAIL || m.kind > Monster.HOPPER) throw new RangeError('bad monster kind');
    if (!inBounds(m.x, m.y)) throw new RangeError('monster outside the arena');
    const cell = cellIndex(m.x, m.y);
    state.monKind[i] = m.kind;
    state.monAlive[i] = 1;
    state.monCell[i] = cell;
    state.monNext[i] = cell;
    state.monDir[i] = Dir.NONE;
    state.monJump[i] = 0;
    state.monAux[i] = 0;
    const delay = MONSTER_START_DELAY + 6 * i;
    state.monSpan[i] = delay;
    state.monTimer[i] = delay;
  });
}

/** Number of monsters still alive. */
export function monstersAlive(state: SimState): number {
  let n = 0;
  for (let i = 0; i < MAX_MONSTERS; i++) if (state.monAlive[i]) n++;
  return n;
}

/** Number of monsters the match started with. */
export function monsterCount(state: SimState): number {
  let n = 0;
  for (let i = 0; i < MAX_MONSTERS; i++) if (state.monKind[i] !== Monster.NONE) n++;
  return n;
}

/** The tile monster `i` counts as standing on right now. */
export function monsterCell(state: SimState, i: number): number {
  return (state.monTimer[i] as number) * 2 <= (state.monSpan[i] as number)
    ? (state.monNext[i] as number)
    : (state.monCell[i] as number);
}

function walkable(state: SimState, cell: number): boolean {
  if (state.tiles[cell] !== Tile.FLOOR) return false;
  const x = cell % GRID_W;
  return bombAt(state, x, (cell - x) / GRID_W) < 0;
}

/** Is another monster on or heading for `cell`? */
function claimed(state: SimState, self: number, cell: number): boolean {
  for (let j = 0; j < MAX_MONSTERS; j++) {
    if (j === self || !state.monAlive[j]) continue;
    if (state.monCell[j] === cell || state.monNext[j] === cell) return true;
  }
  return false;
}

function neighbour(cell: number, dir: number, steps = 1): number {
  const x = (cell % GRID_W) + (DIR_DX[dir] as number) * steps;
  const y = Math.floor(cell / GRID_W) + (DIR_DY[dir] as number) * steps;
  return inBounds(x, y) ? cellIndex(x, y) : -1;
}

function opposite(dir: number): number {
  return ((dir + 1) % 4) + 1;
}

const options = new Uint8Array(4);
const distTo = new Int16Array(GRID_W * GRID_H);
const firstStep = new Uint8Array(GRID_W * GRID_H);
const queue = new Int16Array(GRID_W * GRID_H);

/** First step (`Dir`) of the shortest walkable path to the nearest seat in sight, or NONE. */
function houndStep(state: SimState, i: number): number {
  const start = state.monCell[i] as number;
  distTo.fill(-1);
  distTo[start] = 0;
  firstStep[start] = 0;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cell = queue[head++] as number;
    const d = distTo[cell] as number;
    if (d > 0) {
      for (let s = 0; s < MAX_SEATS; s++) {
        if (isSeatActive(state, s) && state.alive[s] && playerCell(state, s) === cell) {
          return firstStep[cell] as number;
        }
      }
    }
    if (d >= HOUND_SIGHT) continue;
    for (let dir = 1; dir <= 4; dir++) {
      const n = neighbour(cell, dir);
      if (n < 0 || (distTo[n] as number) >= 0 || !walkable(state, n)) continue;
      distTo[n] = d + 1;
      firstStep[n] = cell === start ? dir : (firstStep[cell] as number);
      queue[tail++] = n;
    }
  }
  return Dir.NONE;
}

/** Picks the next step of monster `i` (it stands on `monCell`). */
function decide(state: SimState, i: number): void {
  const kind = state.monKind[i] as number;
  const cell = state.monCell[i] as number;
  const stream = RngStream.MONSTER;
  let dir: number = Dir.NONE;
  let target = cell;
  let jump = 0;

  if (kind === Monster.HOPPER && (state.monAux[i] as number) >= HOP_INTERVAL) {
    let n = 0;
    for (let d = 1; d <= 4; d++) {
      const over = neighbour(cell, d);
      const land = neighbour(cell, d, 2);
      if (over < 0 || land < 0) continue;
      const tile = state.tiles[over];
      if (tile !== Tile.CRATE && tile !== Tile.PILLAR) continue;
      if (!walkable(state, land) || claimed(state, i, land)) continue;
      options[n++] = d;
    }
    if (n > 0) {
      dir = options[randInt(state.rng, stream, n)] as number;
      target = neighbour(cell, dir, 2);
      jump = 1;
      state.monAux[i] = 0;
    }
  }

  if (jump === 0) {
    if (kind === Monster.HOUND) {
      const chase = houndStep(state, i);
      const n = chase === Dir.NONE ? -1 : neighbour(cell, chase);
      if (n >= 0 && !claimed(state, i, n)) {
        dir = chase;
        target = n;
      }
    }
    if (target === cell) {
      const back = opposite(state.monDir[i] as number);
      let n = 0;
      let backOk = false;
      for (let d = 1; d <= 4; d++) {
        const c = neighbour(cell, d);
        if (c < 0 || !walkable(state, c) || claimed(state, i, c)) continue;
        if (d === back) backOk = true;
        else options[n++] = d;
      }
      if (n === 0 && backOk) options[n++] = back;
      if (n > 0) {
        dir = options[randInt(state.rng, stream, n)] as number;
        target = neighbour(cell, dir);
      }
    }
  }
  const span = jump ? HOP_TICKS : (MONSTER_STEP_TICKS[kind] as number);
  state.monNext[i] = target;
  state.monJump[i] = jump;
  state.monSpan[i] = span;
  state.monTimer[i] = span;
  if (dir !== Dir.NONE) state.monDir[i] = dir;
}

/**
 * One playing tick of every monster: movement, deaths in flames (or under a falling block) and
 * contact damage to the seats. Does nothing in a match without monsters.
 */
export function updateMonsters(state: SimState, sink: EventSink): void {
  let any = false;
  for (let i = 0; i < MAX_MONSTERS; i++) {
    if (!state.monAlive[i]) continue;
    any = true;
    if (state.monKind[i] === Monster.HOPPER) {
      state.monAux[i] = Math.min(0xffff, (state.monAux[i] as number) + 1);
    }
    const left = (state.monTimer[i] as number) - 1;
    if (left > 0) {
      state.monTimer[i] = left;
      continue;
    }
    state.monCell[i] = state.monNext[i] as number;
    state.monJump[i] = 0;
    decide(state, i);
  }
  if (!any) return;

  for (let i = 0; i < MAX_MONSTERS; i++) {
    if (!state.monAlive[i]) continue;
    const cell = monsterCell(state, i);
    const burning = (state.flame[cell] as number) > 0;
    if (!burning && state.tiles[cell] === Tile.FLOOR) continue;
    state.monAlive[i] = 0;
    sink.emit(
      EventKind.MONSTER_KILLED,
      burning ? (state.flameOwner[cell] as number) : NO_OWNER,
      cell,
      state.monKind[i] as number,
    );
  }

  if (((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.HARMLESS) !== 0) return;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s) || !state.alive[s] || state.invuln[s] !== 0) continue;
    const here = playerCell(state, s);
    let touched = false;
    for (let i = 0; i < MAX_MONSTERS && !touched; i++) {
      touched = state.monAlive[i] !== 0 && monsterCell(state, i) === here;
    }
    if (!touched) continue;
    if (((state.abilities[s] as number) & Ability.SHIELD) !== 0) {
      state.abilities[s] = (state.abilities[s] as number) & ~Ability.SHIELD;
      state.invuln[s] = SHIELD_INVULN;
      sink.emit(EventKind.SHIELD_BROKEN, s, here);
    } else {
      eliminate(state, s, MONSTER_KILLER, sink);
    }
  }
}
