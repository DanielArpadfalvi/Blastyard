import {
  GRID_H,
  GRID_W,
  Hdr,
  Tile,
  cellIndex,
  createEmptyState,
  tileCenter,
  type SimState,
} from '../../../src/core';

/**
 * Builds a state from a tiny hand-drawn map (top-left aligned; everything outside it is wall).
 * `#` wall, `o` pillar, `+` crate, `.` floor, `0`–`3` floor with that seat standing on it.
 */
export function tinyArena(rows: readonly string[]): SimState {
  const state = createEmptyState();
  state.tiles.fill(Tile.WALL);
  let mask = 0;
  for (let y = 0; y < Math.min(rows.length, GRID_H); y++) {
    const row = rows[y] as string;
    for (let x = 0; x < Math.min(row.length, GRID_W); x++) {
      const ch = row[x] as string;
      const i = cellIndex(x, y);
      if (ch === '#') state.tiles[i] = Tile.WALL;
      else if (ch === 'o') state.tiles[i] = Tile.PILLAR;
      else if (ch === '+') state.tiles[i] = Tile.CRATE;
      else {
        state.tiles[i] = Tile.FLOOR;
        if (ch >= '0' && ch <= '3') {
          const seat = Number(ch);
          mask |= 1 << seat;
          state.px[seat] = tileCenter(x);
          state.py[seat] = tileCenter(y);
          state.alive[seat] = 1;
          state.bombCap[seat] = 1;
          state.range[seat] = 2;
        }
      }
    }
  }
  state.hdr[Hdr.SEAT_MASK] = mask;
  return state;
}

/** Input array with `input` for `seat` and nothing for the others. */
export function only(seat: number, input: number): number[] {
  const inputs = [0, 0, 0, 0];
  inputs[seat] = input;
  return inputs;
}

/** Puts an alive, active `seat` at subunit position (x, y). */
export function placeSeat(state: SimState, seat: number, x: number, y: number): void {
  state.px[seat] = x;
  state.py[seat] = y;
  state.alive[seat] = 1;
  state.bombCap[seat] = 1;
  state.range[seat] = 2;
  state.hdr[Hdr.SEAT_MASK] = (state.hdr[Hdr.SEAT_MASK] as number) | (1 << seat);
}
