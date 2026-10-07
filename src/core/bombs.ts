/**
 * Bombs and blasts.
 *
 * Storage: bombs live compacted in creation order in [0, hdr.BOMB_COUNT), so every system
 * iterates them in a fixed order. A bomb occupies the tile containing its centre and blocks
 * movement for everybody except the seats in its `bombPass` mask (those that stood on the tile
 * when it was placed) until they leave that tile.
 *
 * Blasts (PLAN §1.1): a bomb explodes when its fuse (150 ticks) runs out. Its flame covers its own
 * cell plus up to `range` cells in each of the four directions. An arm stops before walls and
 * pillars; a crate absorbs the arm (the crate is destroyed, its cell gets no flame); a bomb in the
 * way is lit (its fuse drops to at most 4 ticks – the visible chain "domino") and the arm stops on
 * its cell. A bomb placed with Pierce (`BombFlag.PIERCE`) destroys every crate within its range
 * and the flame continues behind them. Flames pass over open pickups and burn them – only when a flame is laid, and never
 * during the 30-tick grace after a pickup was revealed. A flame cell stays lethal for 30 ticks; a
 * bomb on a burning cell (e.g. dropped into a lingering flame) is lit as well.
 *
 * Crates hit during one tick are only removed after every explosion of that tick, so two blasts
 * reaching the same crate both stop there – the result never depends on bomb order.
 */

import { EventKind, type EventSink } from './events';
import { BELT_SPEED, TRAMPOLINE_HOP, beltDir } from './floorFx';
import { DIR_DX, DIR_DY, type Direction } from './input';
import {
  Ability,
  BombFlag,
  CELL_COUNT,
  FloorFx,
  Hdr,
  MAX_BOMBS,
  MAX_SEATS,
  Mech,
  NO_OWNER,
  Tile,
  cellIndex,
  inBounds,
  isSeatActive,
  playerCell,
  tileCenter,
  toTile,
  type SimState,
} from './state';

/** Fuse of a regular bomb in ticks (2.5 s). */
export const FUSE_TICKS = 150;
/** Fuse a lit bomb is cut down to when a flame reaches it. */
export const CHAIN_DELAY = 4;
/** Lethal flame lifetime in ticks. */
export const FLAME_TICKS = 30;
/** A freshly revealed pickup is immune to flames for this many ticks. */
export const PICKUP_GRACE = 30;
/** Kick slide speed in subunits per tick (≈ 8 tiles/s). */
export const KICK_SPEED = 34;
/** How far (tiles) a thrown bomb flies; it lands closer when the target is not free. */
export const TOSS_DISTANCE = 3;
/** A bomb press that cannot be served yet is retried for this many further ticks. */
export const BOMB_BUFFER_TICKS = 6;

export function bombCount(state: SimState): number {
  return state.hdr[Hdr.BOMB_COUNT] as number;
}

/** Index of the bomb occupying tile (x, y), or -1. */
export function bombAt(state: SimState, x: number, y: number): number {
  const n = bombCount(state);
  for (let b = 0; b < n; b++) {
    if (toTile(state.bombX[b] as number) === x && toTile(state.bombY[b] as number) === y) return b;
  }
  return -1;
}

/**
 * Adds a resting bomb centred on tile (x, y). Every alive seat whose centre is on that tile may
 * walk off it (owner pass-through). Returns the bomb index, or -1 when the tile is already taken
 * or the bomb table is full.
 */
export function addBomb(
  state: SimState,
  x: number,
  y: number,
  owner: number,
  fuse: number,
  range: number,
  flags = 0,
): number {
  const n = bombCount(state);
  if (n >= MAX_BOMBS || bombAt(state, x, y) >= 0) return -1;
  state.bombX[n] = tileCenter(x);
  state.bombY[n] = tileCenter(y);
  state.bombFuse[n] = fuse;
  state.bombOwner[n] = owner;
  state.bombRange[n] = range;
  state.bombFlags[n] = flags;
  state.bombSlide[n] = 0;
  const cell = cellIndex(x, y);
  let pass = 0;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (isSeatActive(state, s) && state.alive[s] && playerCell(state, s) === cell) pass |= 1 << s;
  }
  state.bombPass[n] = pass;
  state.hdr[Hdr.BOMB_COUNT] = n + 1;
  return n;
}

/** Removes bomb `b`, shifting later bombs down to keep creation order. */
export function removeBomb(state: SimState, b: number): void {
  const n = bombCount(state);
  if (b < 0 || b >= n) return;
  for (let i = b; i < n - 1; i++) {
    state.bombX[i] = state.bombX[i + 1] as number;
    state.bombY[i] = state.bombY[i + 1] as number;
    state.bombFuse[i] = state.bombFuse[i + 1] as number;
    state.bombOwner[i] = state.bombOwner[i + 1] as number;
    state.bombRange[i] = state.bombRange[i + 1] as number;
    state.bombPass[i] = state.bombPass[i + 1] as number;
    state.bombFlags[i] = state.bombFlags[i + 1] as number;
    state.bombSlide[i] = state.bombSlide[i + 1] as number;
  }
  const last = n - 1;
  state.bombX[last] = 0;
  state.bombY[last] = 0;
  state.bombFuse[last] = 0;
  state.bombOwner[last] = NO_OWNER;
  state.bombRange[last] = 0;
  state.bombPass[last] = 0;
  state.bombFlags[last] = 0;
  state.bombSlide[last] = 0;
  state.hdr[Hdr.BOMB_COUNT] = last;
}

/** Clears every bomb (round reset). */
export function clearBombs(state: SimState): void {
  state.hdr[Hdr.BOMB_COUNT] = 0;
  state.bombX.fill(0);
  state.bombY.fill(0);
  state.bombFuse.fill(0);
  state.bombOwner.fill(NO_OWNER);
  state.bombRange.fill(0);
  state.bombPass.fill(0);
  state.bombFlags.fill(0);
  state.bombSlide.fill(0);
}

/** May `seat` occupy the tile of bomb `b`? */
export function canPassBomb(state: SimState, b: number, seat: number): boolean {
  return ((state.bombPass[b] as number) & (1 << seat)) !== 0;
}

/** Clears pass-through bits of seats that no longer stand on the bomb's tile. Run after movement. */
export function releaseBombPass(state: SimState): void {
  const n = bombCount(state);
  for (let b = 0; b < n; b++) {
    let pass = state.bombPass[b] as number;
    if (pass === 0) continue;
    const cell = cellIndex(toTile(state.bombX[b] as number), toTile(state.bombY[b] as number));
    for (let s = 0; s < MAX_SEATS; s++) {
      if ((pass & (1 << s)) !== 0 && (!state.alive[s] || playerCell(state, s) !== cell)) {
        pass &= ~(1 << s);
      }
    }
    state.bombPass[b] = pass;
  }
}

/** Number of bombs owned by `seat` currently on the field (ghost bombs included). */
export function bombsOwnedBy(state: SimState, seat: number): number {
  const n = bombCount(state);
  let count = 0;
  for (let b = 0; b < n; b++) if (state.bombOwner[b] === seat) count++;
  return count;
}

/** Regular (non-ghost) bombs of `seat` on the field – what counts against its capacity. */
export function bombsInUse(state: SimState, seat: number): number {
  const n = bombCount(state);
  let count = 0;
  for (let b = 0; b < n; b++) {
    if (state.bombOwner[b] === seat && ((state.bombFlags[b] as number) & BombFlag.GHOST) === 0) {
      count++;
    }
  }
  return count;
}

/** Lights bomb `b`: it explodes within `CHAIN_DELAY` ticks (never later than its own fuse). */
function light(state: SimState, b: number): void {
  if ((state.bombFuse[b] as number) > CHAIN_DELAY) state.bombFuse[b] = CHAIN_DELAY;
}

/**
 * Handles one alive seat's bomb input for this tick: a press (re)arms the buffer, then placement
 * is attempted on the press tick and on each of the `BOMB_BUFFER_TICKS` following ticks until it
 * succeeds. Placement needs a free capacity slot and no bomb on the seat's tile.
 */
export function updateBombInput(
  state: SimState,
  seat: number,
  pressed: boolean,
  sink: EventSink,
): void {
  if (pressed) {
    state.bombBuffer[seat] = BOMB_BUFFER_TICKS + 1;
    if (tossOwnBomb(state, seat, sink)) {
      state.bombBuffer[seat] = 0;
      return;
    }
  }
  const buffered = state.bombBuffer[seat] as number;
  if (buffered === 0) return;
  if (bombsInUse(state, seat) < (state.bombCap[seat] as number)) {
    const x = toTile(state.px[seat] as number);
    const y = toTile(state.py[seat] as number);
    const flags = ((state.abilities[seat] as number) & Ability.PIERCE) !== 0 ? BombFlag.PIERCE : 0;
    if (addBomb(state, x, y, seat, FUSE_TICKS, state.range[seat] as number, flags) >= 0) {
      state.bombBuffer[seat] = 0;
      sink.emit(EventKind.BOMB_PLACED, seat, cellIndex(x, y));
      if (state.floor[cellIndex(x, y)] === FloorFx.TRAMPOLINE) {
        hopBomb(state, bombCount(state) - 1, state.facing[seat] as Direction, seat, sink);
      }
      return;
    }
  }
  state.bombBuffer[seat] = buffered - 1;
}

/** Is tile (x, y) free for a bomb to land / slide onto (floor, no bomb, nobody standing there)? */
export function bombCanEnter(state: SimState, x: number, y: number): boolean {
  if (!inBounds(x, y) || state.tiles[cellIndex(x, y)] !== Tile.FLOOR) return false;
  if (bombAt(state, x, y) >= 0) return false;
  const cell = cellIndex(x, y);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (isSeatActive(state, s) && state.alive[s] && playerCell(state, s) === cell) return false;
  }
  return true;
}

/**
 * Toss: with the ability and a press while standing on its own bomb (one it may still walk
 * through), the bomb flies `TOSS_DISTANCE` tiles in the facing direction over walls,
 * crates and bombs and lands on the first free floor tile from that distance down to 1.
 * Returns true when a bomb was thrown.
 */
function tossOwnBomb(state: SimState, seat: number, sink: EventSink): boolean {
  if (((state.abilities[seat] as number) & Ability.TOSS) === 0) return false;
  const x = toTile(state.px[seat] as number);
  const y = toTile(state.py[seat] as number);
  const b = bombAt(state, x, y);
  if (b < 0 || state.bombOwner[b] !== seat || !canPassBomb(state, b, seat)) return false;
  const dir = state.facing[seat] as Direction;
  const dx = DIR_DX[dir] as number;
  const dy = DIR_DY[dir] as number;
  if (dx === 0 && dy === 0) return false;
  return flyBomb(state, b, dir, TOSS_DISTANCE, seat, sink);
}

/**
 * Flies bomb `b` up to `distance` tiles in `dir` over walls, crates and bombs; it lands on the
 * first free floor tile from that distance down to 1 (and stays put when none is free).
 */
function flyBomb(
  state: SimState,
  b: number,
  dir: Direction,
  distance: number,
  seat: number,
  sink: EventSink,
): boolean {
  const x = toTile(state.bombX[b] as number);
  const y = toTile(state.bombY[b] as number);
  const dx = DIR_DX[dir] as number;
  const dy = DIR_DY[dir] as number;
  if (dx === 0 && dy === 0) return false;
  for (let d = distance; d >= 1; d--) {
    const lx = x + dx * d;
    const ly = y + dy * d;
    if (!bombCanEnter(state, lx, ly)) continue;
    state.bombX[b] = tileCenter(lx);
    state.bombY[b] = tileCenter(ly);
    state.bombPass[b] = 0;
    state.bombSlide[b] = 0;
    state.bombFlags[b] = (state.bombFlags[b] as number) & ~BombFlag.BELT;
    sink.emit(EventKind.BOMB_TOSSED, seat, cellIndex(lx, ly), cellIndex(x, y));
    return true;
  }
  return false;
}

/** Trampoline: bomb `b` hops `TRAMPOLINE_HOP` tiles in `dir` (lands closer when blocked). */
function hopBomb(state: SimState, b: number, dir: Direction, seat: number, sink: EventSink): void {
  flyBomb(state, b, dir, TRAMPOLINE_HOP, seat, sink);
}

/**
 * Kick: bomb `b` starts sliding in `dir` if the next tile is free. Returns true when it did.
 */
export function kickBomb(
  state: SimState,
  b: number,
  dir: Direction,
  seat: number,
  sink?: EventSink,
): boolean {
  if (state.bombSlide[b] !== 0) return false;
  const x = toTile(state.bombX[b] as number);
  const y = toTile(state.bombY[b] as number);
  if (!bombCanEnter(state, x + (DIR_DX[dir] as number), y + (DIR_DY[dir] as number))) return false;
  state.bombSlide[b] = dir;
  state.bombFlags[b] = (state.bombFlags[b] as number) & ~BombFlag.BELT;
  state.bombPass[b] = 0;
  sink?.emit(EventKind.BOMB_KICKED, seat, cellIndex(x, y), dir);
  return true;
}

/**
 * Moves every sliding bomb: kicked ones by `KICK_SPEED`, belt-carried ones by `BELT_SPEED`. A bomb
 * only continues into the next tile from a tile centre: it stops dead at the centre when that
 * tile is not free, and never overshoots a centre within a tick. A resting bomb whose owner has
 * left it is picked up by a conveyor belt at its centre; a belt bomb follows the belts' turns and
 * stops where the belts end. A sliding bomb that reaches a trampoline centre hops over it.
 */
export function slideBombs(state: SimState, sink?: EventSink): void {
  const n = bombCount(state);
  const belts = ((state.hdr[Hdr.MECH] as number) & Mech.BELT) !== 0;
  for (let b = 0; b < n; b++) {
    let dir = state.bombSlide[b] as Direction;
    let belt = ((state.bombFlags[b] as number) & BombFlag.BELT) !== 0;
    const bx = state.bombX[b] as number;
    const by = state.bombY[b] as number;
    const tx = toTile(bx);
    const ty = toTile(by);
    const atCentre = bx === tileCenter(tx) && by === tileCenter(ty);
    if (belts && atCentre && (dir === 0 || belt)) {
      // Belt pick-up / continuation at a tile centre.
      const bd = beltDir(state.floor[cellIndex(tx, ty)] as number);
      const free =
        bd !== 0 &&
        (dir !== 0 || state.bombPass[b] === 0) &&
        bombCanEnter(state, tx + (DIR_DX[bd] as number), ty + (DIR_DY[bd] as number));
      if (free) {
        dir = bd;
        belt = true;
        state.bombSlide[b] = dir;
        state.bombFlags[b] = (state.bombFlags[b] as number) | BombFlag.BELT;
      } else if (belt) {
        state.bombSlide[b] = 0;
        state.bombFlags[b] = (state.bombFlags[b] as number) & ~BombFlag.BELT;
        continue;
      }
    }
    if (dir === 0) continue;
    const dx = DIR_DX[dir] as number;
    const dy = DIR_DY[dir] as number;
    const horiz = dx !== 0;
    const pos = horiz ? bx : by;
    const sign = dx + dy;
    const centre = tileCenter(toTile(pos));
    let next = pos + sign * (belt ? BELT_SPEED : KICK_SPEED);
    if (pos === centre) {
      if (!bombCanEnter(state, tx + dx, ty + dy)) {
        state.bombSlide[b] = 0;
        state.bombFlags[b] = (state.bombFlags[b] as number) & ~BombFlag.BELT;
        continue;
      }
    } else if (sign > 0 ? pos < centre && next >= centre : pos > centre && next <= centre) {
      next = centre;
    }
    if (horiz) state.bombX[b] = next;
    else state.bombY[b] = next;
    if (
      sink &&
      next === centre &&
      pos !== centre &&
      state.floor[cellIndex(toTile(state.bombX[b] as number), toTile(state.bombY[b] as number))] ===
        FloorFx.TRAMPOLINE
    ) {
      hopBomb(state, b, dir, state.bombOwner[b] as number, sink);
    }
  }
}

const ARM_DX: readonly number[] = [0, 1, 0, -1];
const ARM_DY: readonly number[] = [-1, 0, 1, 0];

/** Crates hit during the current tick: module scratch, emptied before `updateBombs` returns. */
const crateQueue = new Int16Array(CELL_COUNT);
const crateMark = new Uint8Array(CELL_COUNT);
let crateCount = 0;

/** Lays a fresh flame on `cell`, burning an open pickup that is out of its grace period. */
function burnCell(state: SimState, cell: number, owner: number, sink: EventSink): void {
  state.flame[cell] = FLAME_TICKS;
  state.flameOwner[cell] = owner;
  const kind = state.pickup[cell] as number;
  if (kind !== 0 && state.pickupGrace[cell] === 0) {
    state.pickup[cell] = 0;
    sink.emit(EventKind.PICKUP_BURNED, NO_OWNER, cell, kind);
  }
}

function explode(state: SimState, b: number, sink: EventSink): void {
  const bx = toTile(state.bombX[b] as number);
  const by = toTile(state.bombY[b] as number);
  const owner = state.bombOwner[b] as number;
  const range = state.bombRange[b] as number;
  const pierce = ((state.bombFlags[b] as number) & BombFlag.PIERCE) !== 0;
  const center = cellIndex(bx, by);
  sink.emit(EventKind.BOMB_EXPLODED, owner, center, range);
  burnCell(state, center, owner, sink);
  for (let arm = 0; arm < 4; arm++) {
    const dx = ARM_DX[arm] as number;
    const dy = ARM_DY[arm] as number;
    for (let r = 1; r <= range; r++) {
      const x = bx + dx * r;
      const y = by + dy * r;
      if (!inBounds(x, y)) break;
      const cell = cellIndex(x, y);
      const tile = state.tiles[cell] as number;
      if (tile === Tile.WALL || tile === Tile.PILLAR) break;
      if (tile === Tile.CRATE) {
        if (crateMark[cell] === 0) {
          crateMark[cell] = 1;
          crateQueue[crateCount++] = cell;
        }
        if (!pierce) break;
        // Pierce: the crate burns away and the flame carries on behind it.
        burnCell(state, cell, owner, sink);
        continue;
      }
      burnCell(state, cell, owner, sink);
      const other = bombAt(state, x, y);
      if (other >= 0) {
        // A bomb exploding in this very tick is removed below anyway; lighting it is harmless.
        light(state, other);
        break;
      }
    }
  }
}

/**
 * Advances every bomb fuse by one tick and resolves this tick's explosions in creation order,
 * then removes the exploded bombs and the destroyed crates, revealing hidden pickups with a grace
 * period. Exploded bombs free their owner's capacity immediately.
 */
export function updateBombs(state: SimState, sink: EventSink): void {
  const n = bombCount(state);
  if (n === 0) return;
  let exploding = 0;
  for (let b = 0; b < n; b++) {
    const fuse = (state.bombFuse[b] as number) - 1;
    state.bombFuse[b] = fuse > 0 ? fuse : 0;
    if (fuse <= 0) {
      state.bombFlags[b] = (state.bombFlags[b] as number) | BombFlag.EXPLODING;
      exploding++;
    }
  }
  if (exploding === 0) return;

  crateCount = 0;
  for (let b = 0; b < n; b++) {
    if (((state.bombFlags[b] as number) & BombFlag.EXPLODING) !== 0) explode(state, b, sink);
  }
  for (let b = n - 1; b >= 0; b--) {
    if (((state.bombFlags[b] as number) & BombFlag.EXPLODING) !== 0) removeBomb(state, b);
  }
  for (let i = 0; i < crateCount; i++) {
    const cell = crateQueue[i] as number;
    crateMark[cell] = 0;
    state.tiles[cell] = Tile.FLOOR;
    const hidden = state.hidden[cell] as number;
    state.hidden[cell] = 0;
    if (hidden !== 0) {
      state.pickup[cell] = hidden;
      state.pickupGrace[cell] = PICKUP_GRACE;
    }
    sink.emit(EventKind.CRATE_DESTROYED, NO_OWNER, cell, hidden);
  }
  crateCount = 0;
}

/** Lights every bomb that sits on a burning cell (lingering flames, bombs dropped into fire). */
export function lightBombsInFlames(state: SimState): void {
  const n = bombCount(state);
  for (let b = 0; b < n; b++) {
    const cell = cellIndex(toTile(state.bombX[b] as number), toTile(state.bombY[b] as number));
    if ((state.flame[cell] as number) > 0) light(state, b);
  }
}

/** Ages flames and pickup grace timers by one tick (run at the end of a tick). */
export function decayFlames(state: SimState): void {
  const flame = state.flame;
  const owner = state.flameOwner;
  const grace = state.pickupGrace;
  for (let i = 0; i < CELL_COUNT; i++) {
    const f = flame[i] as number;
    if (f !== 0) {
      flame[i] = f - 1;
      if (f === 1) owner[i] = NO_OWNER;
    }
    const g = grace[i] as number;
    if (g !== 0) grace[i] = g - 1;
  }
}
