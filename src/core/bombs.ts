/**
 * Bomb storage: bombs live compacted in creation order in [0, hdr.BOMB_COUNT), so every system
 * iterates them in a fixed order. A bomb occupies the tile containing its centre and blocks
 * movement for everybody except the seats in its `bombPass` mask (those that stood on the tile
 * when it was placed) until they leave that tile.
 */

import {
  Hdr,
  MAX_BOMBS,
  MAX_SEATS,
  NO_OWNER,
  isSeatActive,
  playerCell,
  tileCenter,
  toTile,
  cellIndex,
  type SimState,
} from './state';

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
): number {
  const n = bombCount(state);
  if (n >= MAX_BOMBS || bombAt(state, x, y) >= 0) return -1;
  state.bombX[n] = tileCenter(x);
  state.bombY[n] = tileCenter(y);
  state.bombFuse[n] = fuse;
  state.bombOwner[n] = owner;
  state.bombRange[n] = range;
  state.bombFlags[n] = 0;
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

/** Number of bombs owned by `seat` currently on the field. */
export function bombsOwnedBy(state: SimState, seat: number): number {
  const n = bombCount(state);
  let count = 0;
  for (let b = 0; b < n; b++) if (state.bombOwner[b] === seat) count++;
  return count;
}
