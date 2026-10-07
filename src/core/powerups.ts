/**
 * Power-ups: pickup, passive effects and the Jinx curse (PLAN §1.2).
 *
 * A seat collects the open pickup on its tile (the tile containing its centre). Stat pickups take
 * effect at once: Extra Pop +1 capacity (max 6), Flame +1 range (max 7), Roller +1 speed level
 * (max 4, +2 subunits/tick each), Max Flame sets the range to 7. Kick, Toss, Pierce and Shield
 * grant an ability bit; Kick and Toss replace each other. Their behaviour lives where it acts:
 * Kick in `movement.ts` / `bombs.ts` (slide), Toss and Pierce in `bombs.ts`, Shield in
 * `round.ts` (`applyFlameDamage`).
 *
 * Jinx: collecting it starts a random curse for `JINX_TICKS` (10 s) from the LOOT stream:
 * reversed directions, half speed, "haste" (a bomb is pressed every `HASTE_INTERVAL` ticks) or a
 * bomb ban. A cursed seat that touches an uncursed one (centres closer than `JINX_TOUCH`) passes
 * the curse on with the time it has left; both seats then ignore transfers for
 * `JINX_TRANSFER_COOLDOWN` ticks so it cannot ping-pong. The curse ends on elimination.
 *
 * Death drops: when a seat is eliminated up to `MAX_DROPS` of the power-ups it had collected
 * (derived from its stats and ability bits) are scattered over free floor cells (LOOT stream).
 */

import { PICKUP_GRACE, bombAt } from './bombs';
import { EventKind, type EventSink } from './events';
import {
  Dir,
  INPUT_BOMB,
  encodeInput,
  inputBomb,
  inputMain,
  inputSecondary,
  type Direction,
} from './input';
import { MAX_SPEED_LEVEL } from './movement';
import { RngStream, randInt } from './rng';
import {
  Ability,
  CELL_COUNT,
  GRID_W,
  Hdr,
  JINX_EFFECT_COUNT,
  Jinx,
  MAX_SEATS,
  Pickup,
  TILE,
  Tile,
  isSeatActive,
  playerCell,
  type SimState,
} from './state';

export const MAX_BOMB_CAPACITY = 6;
export const MAX_RANGE = 7;
/** Jinx duration: 10 s. */
export const JINX_TICKS = 600;
export const JINX_TRANSFER_COOLDOWN = 60;
/** Centre distance (|dx| + |dy| in subunits) under which two seats "touch". */
export const JINX_TOUCH = (TILE * 3) >> 2;
/** Ticks between the automatic bomb presses of the haste curse. */
export const HASTE_INTERVAL = 45;
/** Invulnerability granted after a Shield absorbed a hit. */
export const SHIELD_INVULN = 60;
/** Most power-ups an eliminated seat scatters. */
export const MAX_DROPS = 4;

/** Applies pickup `kind` to `seat`. */
export function applyPickup(state: SimState, seat: number, kind: number, sink?: EventSink): void {
  switch (kind) {
    case Pickup.EXTRA_POP:
      state.bombCap[seat] = Math.min((state.bombCap[seat] as number) + 1, MAX_BOMB_CAPACITY);
      break;
    case Pickup.FLAME:
      state.range[seat] = Math.min((state.range[seat] as number) + 1, MAX_RANGE);
      break;
    case Pickup.ROLLER:
      state.speedLvl[seat] = Math.min((state.speedLvl[seat] as number) + 1, MAX_SPEED_LEVEL);
      break;
    case Pickup.MAX_FLAME:
      state.range[seat] = MAX_RANGE;
      break;
    case Pickup.KICK:
      state.abilities[seat] = ((state.abilities[seat] as number) & ~Ability.TOSS) | Ability.KICK;
      break;
    case Pickup.TOSS:
      state.abilities[seat] = ((state.abilities[seat] as number) & ~Ability.KICK) | Ability.TOSS;
      break;
    case Pickup.PIERCE:
      state.abilities[seat] = (state.abilities[seat] as number) | Ability.PIERCE;
      break;
    case Pickup.SHIELD:
      state.abilities[seat] = (state.abilities[seat] as number) | Ability.SHIELD;
      break;
    case Pickup.JINX: {
      const effect = randInt(state.rng, RngStream.LOOT, JINX_EFFECT_COUNT) + 1;
      state.jinx[seat] = effect;
      state.jinxTicks[seat] = JINX_TICKS;
      sink?.emit(EventKind.JINX_CAUGHT, seat, playerCell(state, seat), effect);
      break;
    }
    default:
      break;
  }
}

/** Every alive seat (in seat order) collects the open pickup on its tile. */
export function collectPickups(state: SimState, sink: EventSink): void {
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s) || !state.alive[s]) continue;
    const cell = playerCell(state, s);
    const kind = state.pickup[cell] as number;
    if (kind === 0) continue;
    state.pickup[cell] = 0;
    state.pickupGrace[cell] = 0;
    applyPickup(state, s, kind, sink);
    sink.emit(EventKind.PICKUP_COLLECTED, s, cell, kind);
  }
}

// ---------------------------------------------------------------------------------------------
// Jinx

function reverse(dir: Direction): Direction {
  switch (dir) {
    case Dir.UP:
      return Dir.DOWN;
    case Dir.DOWN:
      return Dir.UP;
    case Dir.LEFT:
      return Dir.RIGHT;
    case Dir.RIGHT:
      return Dir.LEFT;
    default:
      return Dir.NONE;
  }
}

/** The input byte the simulation really uses for `seat` under its curse (identity without one). */
export function jinxInput(state: SimState, seat: number, input: number): number {
  switch (state.jinx[seat]) {
    case Jinx.REVERSED:
      return encodeInput(
        reverse(inputMain(input)),
        reverse(inputSecondary(input)),
        inputBomb(input),
      );
    case Jinx.HASTE:
      return (state.jinxTicks[seat] as number) % HASTE_INTERVAL === 0 ? input | INPUT_BOMB : input;
    case Jinx.NO_BOMB:
      return input & ~INPUT_BOMB;
    default:
      return input;
  }
}

/** Ages every curse by one tick, ends expired ones and passes curses on between touching seats. */
export function updateJinx(state: SimState, sink: EventSink): void {
  for (let s = 0; s < MAX_SEATS; s++) {
    if ((state.jinxCd[s] as number) > 0) state.jinxCd[s] = (state.jinxCd[s] as number) - 1;
    if (state.jinx[s] === Jinx.NONE) continue;
    const left = (state.jinxTicks[s] as number) - 1;
    state.jinxTicks[s] = left;
    if (left <= 0) {
      state.jinx[s] = Jinx.NONE;
      state.jinxTicks[s] = 0;
    }
  }
  for (let a = 0; a < MAX_SEATS; a++) {
    if (state.jinx[a] === Jinx.NONE || state.jinxCd[a] !== 0) continue;
    if (!isSeatActive(state, a) || !state.alive[a]) continue;
    for (let b = 0; b < MAX_SEATS; b++) {
      if (b === a || state.jinx[b] !== Jinx.NONE || state.jinxCd[b] !== 0) continue;
      if (!isSeatActive(state, b) || !state.alive[b]) continue;
      const d =
        Math.abs((state.px[a] as number) - (state.px[b] as number)) +
        Math.abs((state.py[a] as number) - (state.py[b] as number));
      if (d >= JINX_TOUCH) continue;
      state.jinx[b] = state.jinx[a] as number;
      state.jinxTicks[b] = state.jinxTicks[a] as number;
      state.jinx[a] = Jinx.NONE;
      state.jinxTicks[a] = 0;
      state.jinxCd[a] = JINX_TRANSFER_COOLDOWN;
      state.jinxCd[b] = JINX_TRANSFER_COOLDOWN;
      sink.emit(EventKind.JINX_PASSED, a, playerCell(state, b), b);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Death drops

const dropKinds = new Uint8Array(32);
const freeCells = new Int16Array(CELL_COUNT);

/** Fills `dropKinds` with the power-ups `seat` collected beyond its starting kit; returns the count. */
function collected(state: SimState, seat: number): number {
  const hdr = state.hdr;
  let n = 0;
  const pop = (state.bombCap[seat] as number) - (hdr[Hdr.START_BOMBS] as number);
  for (let i = 0; i < pop; i++) dropKinds[n++] = Pickup.EXTRA_POP;
  const flame = (state.range[seat] as number) - (hdr[Hdr.START_RANGE] as number);
  for (let i = 0; i < flame; i++) dropKinds[n++] = Pickup.FLAME;
  const roller = (state.speedLvl[seat] as number) - (hdr[Hdr.START_SPEED] as number);
  for (let i = 0; i < roller; i++) dropKinds[n++] = Pickup.ROLLER;
  const ab = state.abilities[seat] as number;
  if ((ab & Ability.KICK) !== 0) dropKinds[n++] = Pickup.KICK;
  if ((ab & Ability.TOSS) !== 0) dropKinds[n++] = Pickup.TOSS;
  if ((ab & Ability.PIERCE) !== 0) dropKinds[n++] = Pickup.PIERCE;
  if ((ab & Ability.SHIELD) !== 0) dropKinds[n++] = Pickup.SHIELD;
  return n;
}

/**
 * Scatters up to `MAX_DROPS` of the power-ups `seat` collected onto free floor cells (no pickup,
 * bomb or flame). Which ones and where is drawn from the LOOT stream; the cell order is fixed.
 */
export function dropPickups(state: SimState, seat: number, sink: EventSink): void {
  const n = collected(state, seat);
  if (n === 0) return;
  let cells = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    if (state.tiles[c] !== Tile.FLOOR || state.pickup[c] !== 0 || state.flame[c] !== 0) continue;
    if (bombAt(state, c % GRID_W, Math.floor(c / GRID_W)) >= 0) continue;
    freeCells[cells++] = c;
  }
  const drops = Math.min(MAX_DROPS, n, cells);
  for (let i = 0; i < drops; i++) {
    // Partial Fisher–Yates over both lists.
    const k = i + randInt(state.rng, RngStream.LOOT, n - i);
    const kind = dropKinds[k] as number;
    dropKinds[k] = dropKinds[i] as number;
    dropKinds[i] = kind;
    const j = i + randInt(state.rng, RngStream.LOOT, cells - i);
    const cell = freeCells[j] as number;
    freeCells[j] = freeCells[i] as number;
    freeCells[i] = cell;
    state.pickup[cell] = kind;
    state.pickupGrace[cell] = PICKUP_GRACE;
    sink.emit(EventKind.PICKUP_DROPPED, seat, cell, kind);
  }
}
