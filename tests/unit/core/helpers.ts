import {
  GRID_H,
  GRID_W,
  Hdr,
  LayoutCell,
  Phase,
  Tile,
  cellIndex,
  createEmptyState,
  step,
  tileCenter,
  type SimState,
} from '../../../src/core';

/**
 * Builds a state from a tiny hand-drawn map (top-left aligned; everything outside it is wall).
 * `#` wall, `o` pillar, `+` crate, `.` floor, `0`–`3` floor with that seat standing on it.
 * The state is already PLAYING (no countdown) with no rule flags, no round clock and one win to
 * take the match; the drawn map is also stored as the layout (crates become fixed crates).
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
          state.spawnCell[seat] = i;
          state.px[seat] = tileCenter(x);
          state.py[seat] = tileCenter(y);
          state.alive[seat] = 1;
          state.bombCap[seat] = 1;
          state.range[seat] = 2;
        }
      }
    }
  }
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    state.layout[i] =
      t === Tile.WALL
        ? LayoutCell.WALL
        : t === Tile.PILLAR
          ? LayoutCell.PILLAR
          : t === Tile.CRATE
            ? LayoutCell.FIXED_CRATE
            : LayoutCell.FLOOR;
  }
  state.weights.fill(1);
  state.hdr[Hdr.SEAT_MASK] = mask;
  state.hdr[Hdr.WINS_TO_MATCH] = 1;
  state.hdr[Hdr.START_BOMBS] = 1;
  state.hdr[Hdr.START_RANGE] = 2;
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

/** Steps through the 3-2-1 countdown of a freshly created (or restarted) round. */
export function skipCountdown(state: SimState): void {
  while (state.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(state, [0, 0, 0, 0]);
}
