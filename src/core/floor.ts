/**
 * Floor mechanics (T4.3, PLAN §1.8): the per-cell `floor` layer of an arena.
 *
 * - Ice: `movePlayer` lets a player keep gliding up to `ICE_SLIDE` (2 tiles) after letting go.
 * - Conveyor belts: every tick a player or resting bomb standing on a belt is carried
 *   `BELT_SPEED` (8) subunits along it. Players are only carried while centred across the belt;
 *   a bomb rides from tile centre to tile centre and follows the belts' turns.
 * - Teleports / tunnels: a player whose centre gets close to a pad's centre is moved to the
 *   paired pad (unless a bomb sits there) and cannot bounce back until it steps off a pad.
 * - Trampolines: see `bombs.ts` (a bomb placed on, or sliding onto, one hops `TRAMPOLINE_HOP`).
 * - Growing pillars: once the round clock is past 75% a `GROW` cell turns into a pillar every
 *   `GROW_INTERVAL` ticks (in cell order). It destroys what stands on it and eliminates seats.
 *
 * Every pass is skipped when the arena declares no such mechanic (`Hdr.MECH`), so classic arenas
 * cost nothing and play exactly as before.
 */

import { bombAt, removeBomb } from './bombs';
import { EventKind, type EventSink } from './events';
import { Dir } from './input';
import { BELT_SPEED, GROW_AT_PERCENT, GROW_INTERVAL, TELEPORT_WINDOW, beltDir } from './floorFx';
import { conveyPlayer } from './movement';
import { eliminate } from './round';
import {
  CELL_COUNT,
  FloorFx,
  GRID_W,
  Hdr,
  MAX_SEATS,
  Mech,
  NO_OWNER,
  Tile,
  isSeatActive,
  playerCell,
  tileCenter,
  type SimState,
} from './state';

/** Teleports players and carries them along belts (after movement, before bomb passes). */
export function applyFloors(state: SimState, sink: EventSink): void {
  const mech = state.hdr[Hdr.MECH] as number;
  if ((mech & (Mech.TELEPORT | Mech.BELT)) === 0) return;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s) || !state.alive[s]) continue;
    const cell = playerCell(state, s);
    const fx = state.floor[cell] as number;
    if (fx === FloorFx.TELEPORT || fx === FloorFx.TUNNEL) {
      if (state.tpLock[s] === 0) teleport(state, s, cell, sink);
    } else {
      state.tpLock[s] = 0;
      const dir = beltDir(fx);
      if (dir !== Dir.NONE) conveyPlayer(state, s, dir, BELT_SPEED);
    }
  }
}

function teleport(state: SimState, seat: number, cell: number, sink: EventSink): void {
  const cx = tileCenter(cell % GRID_W);
  const cy = tileCenter((cell - (cell % GRID_W)) / GRID_W);
  if (
    Math.abs((state.px[seat] as number) - cx) > TELEPORT_WINDOW ||
    Math.abs((state.py[seat] as number) - cy) > TELEPORT_WINDOW
  ) {
    return;
  }
  const dest = state.partner[cell] as number;
  if (dest === 0) return;
  const dx = dest % GRID_W;
  const dy = (dest - dx) / GRID_W;
  if (bombAt(state, dx, dy) >= 0) return;
  state.px[seat] = tileCenter(dx);
  state.py[seat] = tileCenter(dy);
  state.tpLock[seat] = 1;
  state.slideLeft[seat] = 0;
  sink.emit(EventKind.TELEPORTED, seat, dest, cell);
}

/** First `GROW` cell (cell order) that has not risen yet, or −1. */
export function nextGrowCell(state: SimState): number {
  for (let c = 0; c < CELL_COUNT; c++) {
    if (state.floor[c] === FloorFx.GROW && state.tiles[c] === Tile.FLOOR) return c;
  }
  return -1;
}

/** Advances the growing-pillar clock by one playing tick. */
export function updateGrow(state: SimState, sink: EventSink): void {
  if (((state.hdr[Hdr.MECH] as number) & Mech.GROW) === 0) return;
  const hdr = state.hdr;
  const timer = hdr[Hdr.GROW_TIMER] as number;
  if (timer < 0) return;
  if (timer === 0) {
    const total = hdr[Hdr.ROUND_TICKS] as number;
    if (total <= 0) return;
    const elapsed = total - (hdr[Hdr.ROUND_TIME] as number);
    if (elapsed * 100 >= total * GROW_AT_PERCENT) hdr[Hdr.GROW_TIMER] = GROW_INTERVAL;
    return;
  }
  if (timer > 1) {
    hdr[Hdr.GROW_TIMER] = timer - 1;
    return;
  }
  const cell = nextGrowCell(state);
  if (cell < 0) {
    hdr[Hdr.GROW_TIMER] = -1;
    return;
  }
  growPillar(state, cell, sink);
  hdr[Hdr.GROW_TIMER] = nextGrowCell(state) < 0 ? -1 : GROW_INTERVAL;
}

function growPillar(state: SimState, cell: number, sink: EventSink): void {
  state.tiles[cell] = Tile.PILLAR;
  state.hidden[cell] = 0;
  state.pickup[cell] = 0;
  state.pickupGrace[cell] = 0;
  state.flame[cell] = 0;
  state.flameOwner[cell] = NO_OWNER;
  const x = cell % GRID_W;
  const b = bombAt(state, x, (cell - x) / GRID_W);
  if (b >= 0) removeBomb(state, b);
  sink.emit(EventKind.PILLAR_GROWN, NO_OWNER, cell);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (isSeatActive(state, s) && state.alive[s] && playerCell(state, s) === cell) {
      eliminate(state, s, NO_OWNER, sink);
    }
  }
}
