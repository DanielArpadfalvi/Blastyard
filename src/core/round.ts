/**
 * Round flow inside `step`: countdown, round clock, the closing spiral (sudden death), flame
 * damage and eliminations, ghost revenge and the round-end check (PLAN §1.1).
 *
 * - Countdown: `COUNTDOWN_TICKS` (3-2-1, one beat per second); nothing moves.
 * - Clock: `ROUND_TICKS` playing ticks (0 = unlimited). When it runs out, the spiral starts (or,
 *   with `suddenDeath: 'none'`, the round is a draw unless decided in that very tick).
 * - Spiral: every `SD_INTERVAL` ticks the next cell of `SPIRAL` (outer interior ring inwards,
 *   clockwise from the top-left) becomes wall – pillars keep their tile but still take a slot.
 *   After `SD_PAUSE_AT` slots only the central 5×5 is left and the spiral pauses for
 *   `SD_PAUSE_TICKS`, then closes completely. A falling block eliminates whoever stands on that
 *   cell, destroys crates, pickups and bombs (without exploding them).
 * - Damage: a seat whose tile is burning is eliminated (a Shield absorbs the hit instead and
 *   grants `SHIELD_INVULN` ticks of invulnerability). In team mode without friendly fire a
 *   teammate's flame does not hurt (one's own flame always does). All eliminations of a tick
 *   happen together, so seats caught in the same tick die simultaneously.
 * - Ghosts (rule): an eliminated seat becomes a ghost on the outer wall (projected from where it
 *   died), glides along it at base speed and every `GHOST_BOMB_COOLDOWN` ticks (the first time
 *   one cooldown after its elimination) may drop a ghost bomb – range 1, fuse 3 s – onto the
 *   outermost interior cell next to it. Ghosts cannot be hit and never win a round.
 * - Round end: when at most one side is left (and at least two sides started) that side wins; if
 *   nobody is left the round is a draw (last players eliminated in the same tick). A round with a
 *   single side (solo) ends only when that side is eliminated (draw); a state without seats never
 *   ends.
 */

import { addBomb, bombAt, removeBomb } from './bombs';
import { EventKind, type EventSink } from './events';
import { DIR_DX, DIR_DY, Dir, inputBomb, inputMain, inputSecondary, type Direction } from './input';
import { BASE_SPEED } from './movement';
import { SHIELD_INVULN, dropPickups } from './powerups';
import {
  BombFlag,
  GRID_H,
  GRID_W,
  Ability,
  FloorFx,
  Hdr,
  Jinx,
  MAX_SEATS,
  NO_OWNER,
  NO_SIDE,
  Phase,
  RuleFlag,
  Tile,
  cellIndex,
  isSeatActive,
  playerCell,
  sideOf,
  tileCenter,
  toTile,
  type SimState,
} from './state';

export const COUNTDOWN_TICKS = 180;
/** Ticks between a decided round and the next round's countdown. */
export const ROUND_END_TICKS = 180;
export const SD_INTERVAL = 15;
/** Spiral slots filled when only the central 5×5 is left (rings of 40 + 32 + 24 cells). */
export const SD_PAUSE_AT = 96;
export const SD_PAUSE_TICKS = 600;
export const GHOST_BOMB_COOLDOWN = 480;
export const GHOST_BOMB_FUSE = 180;
export const GHOST_BOMB_RANGE = 1;
export const GHOST_SPEED = BASE_SPEED;

/** Interior cells in closing order: rings from the outside in, each clockwise from top-left. */
function buildSpiral(): number[] {
  const out: number[] = [];
  for (let k = 1; k <= (GRID_W - 1) / 2; k++) {
    const lo = k;
    const hi = GRID_W - 1 - k;
    if (lo === hi) {
      out.push(cellIndex(lo, lo));
      break;
    }
    for (let x = lo; x < hi; x++) out.push(cellIndex(x, lo));
    for (let y = lo; y < hi; y++) out.push(cellIndex(hi, y));
    for (let x = hi; x > lo; x--) out.push(cellIndex(x, hi));
    for (let y = hi; y > lo; y--) out.push(cellIndex(lo, y));
  }
  return out;
}

export const SPIRAL: readonly number[] = buildSpiral();

// ---------------------------------------------------------------------------------------------
// Countdown and clock

/** One countdown tick; switches to PLAYING (and emits ROUND_START) when it reaches zero. */
export function updateCountdown(state: SimState, sink: EventSink): void {
  const hdr = state.hdr;
  const t = hdr[Hdr.PHASE_TIMER] as number;
  if (t > 0 && t % 60 === 0) sink.emit(EventKind.COUNTDOWN, NO_OWNER, -1, t / 60);
  const left = t - 1;
  hdr[Hdr.PHASE_TIMER] = left > 0 ? left : 0;
  if (left <= 0) {
    hdr[Hdr.PHASE] = Phase.PLAYING;
    sink.emit(EventKind.ROUND_START, NO_OWNER, -1, hdr[Hdr.ROUND] as number);
  }
}

/**
 * Advances the round clock and the spiral by one playing tick. Returns true when the time ran
 * out in this tick and there is no sudden death (the round is then over).
 */
export function updateRoundClock(state: SimState, sink: EventSink): boolean {
  const hdr = state.hdr;
  if ((hdr[Hdr.ROUND_TICKS] as number) <= 0) return false;
  const time = hdr[Hdr.ROUND_TIME] as number;
  if (time > 0) {
    hdr[Hdr.ROUND_TIME] = time - 1;
    if (time - 1 > 0) return false;
    if (((hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.SUDDEN_DEATH) === 0) return true;
    sink.emit(EventKind.SUDDEN_DEATH);
    hdr[Hdr.SD_TIMER] = SD_INTERVAL;
    return false;
  }
  const timer = hdr[Hdr.SD_TIMER] as number;
  if (timer <= 0) return false;
  if (timer > 1) {
    hdr[Hdr.SD_TIMER] = timer - 1;
    return false;
  }
  const index = hdr[Hdr.SD_INDEX] as number;
  dropBlock(state, SPIRAL[index] as number, sink);
  const next = index + 1;
  hdr[Hdr.SD_INDEX] = next;
  if (next >= SPIRAL.length) {
    // Tunnel mouths sit on the outer ring, outside the spiral: seal them with the last block.
    for (let c = 0; c < GRID_W * GRID_H; c++) {
      if (state.floor[c] === FloorFx.TUNNEL) dropBlock(state, c, sink);
    }
  }
  hdr[Hdr.SD_TIMER] =
    next >= SPIRAL.length ? 0 : next === SD_PAUSE_AT ? SD_PAUSE_TICKS : SD_INTERVAL;
  return false;
}

/** A sudden-death block falls on `cell`. */
function dropBlock(state: SimState, cell: number, sink: EventSink): void {
  const tile = state.tiles[cell] as number;
  if (tile === Tile.WALL || tile === Tile.PILLAR) return;
  state.tiles[cell] = Tile.WALL;
  state.hidden[cell] = 0;
  state.pickup[cell] = 0;
  state.pickupGrace[cell] = 0;
  state.flame[cell] = 0;
  state.flameOwner[cell] = NO_OWNER;
  const x = cell % GRID_W;
  const b = bombAt(state, x, (cell - x) / GRID_W);
  if (b >= 0) removeBomb(state, b);
  sink.emit(EventKind.BLOCK_DROPPED, NO_OWNER, cell);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (isSeatActive(state, s) && state.alive[s] && playerCell(state, s) === cell) {
      eliminate(state, s, NO_OWNER, sink);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Damage and eliminations

/** Does a flame laid by `owner` hurt `victim`? */
function flameHurts(state: SimState, owner: number, victim: number): boolean {
  const flags = state.hdr[Hdr.RULE_FLAGS] as number;
  if (owner === victim) return (flags & RuleFlag.NO_SELF_DAMAGE) === 0;
  if (owner === NO_OWNER) return true;
  if ((flags & RuleFlag.TEAMS) === 0 || (flags & RuleFlag.FRIENDLY_FIRE) !== 0) return true;
  return sideOf(state, owner) !== sideOf(state, victim);
}

/** Counts the post-shield invulnerability down by one tick. */
export function ageInvulnerability(state: SimState): void {
  for (let s = 0; s < MAX_SEATS; s++) {
    const left = state.invuln[s] as number;
    if (left > 0) state.invuln[s] = left - 1;
  }
}

/** Eliminates every alive seat standing in a lethal flame – all at once. */
export function applyFlameDamage(state: SimState, sink: EventSink): void {
  if (((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.HARMLESS) !== 0) return;
  let victims = 0;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s) || !state.alive[s] || state.invuln[s] !== 0) continue;
    const cell = playerCell(state, s);
    if (state.flame[cell] === 0) continue;
    if (!flameHurts(state, state.flameOwner[cell] as number, s)) continue;
    if (((state.abilities[s] as number) & Ability.SHIELD) !== 0) {
      // The shield takes the hit; a short invulnerability follows.
      state.abilities[s] = (state.abilities[s] as number) & ~Ability.SHIELD;
      state.invuln[s] = SHIELD_INVULN;
      sink.emit(EventKind.SHIELD_BROKEN, s, cell);
      continue;
    }
    victims |= 1 << s;
  }
  if (victims === 0) return;
  for (let s = 0; s < MAX_SEATS; s++) {
    if ((victims & (1 << s)) !== 0) {
      eliminate(state, s, state.flameOwner[playerCell(state, s)] as number, sink);
    }
  }
}

/** Eliminates `seat` (killer `NO_OWNER` = sudden death); it becomes a ghost if the rule is on. */
export function eliminate(state: SimState, seat: number, killer: number, sink: EventSink): void {
  const cell = playerCell(state, seat);
  state.alive[seat] = 0;
  state.bombBuffer[seat] = 0;
  state.moveDir[seat] = Dir.NONE;
  state.jinx[seat] = Jinx.NONE;
  state.jinxTicks[seat] = 0;
  sink.emit(EventKind.DEATH, seat, cell, killer);
  dropPickups(state, seat, sink);
  if (((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.GHOSTS) !== 0) becomeGhost(state, seat);
}

// ---------------------------------------------------------------------------------------------
// Ghost revenge

const RING_LO = tileCenter(0);
const RING_HI_X = tileCenter(GRID_W - 1);
const RING_HI_Y = tileCenter(GRID_H - 1);

/** Moves the seat onto the nearest outer-wall cell (ties: top, right, bottom, left). */
function becomeGhost(state: SimState, seat: number): void {
  const tx = toTile(state.px[seat] as number);
  const ty = toTile(state.py[seat] as number);
  const dTop = ty;
  const dRight = GRID_W - 1 - tx;
  const dBottom = GRID_H - 1 - ty;
  const dLeft = tx;
  const best = Math.min(dTop, dRight, dBottom, dLeft);
  if (dTop === best) {
    state.px[seat] = tileCenter(tx);
    state.py[seat] = RING_LO;
  } else if (dRight === best) {
    state.px[seat] = RING_HI_X;
    state.py[seat] = tileCenter(ty);
  } else if (dBottom === best) {
    state.px[seat] = tileCenter(tx);
    state.py[seat] = RING_HI_Y;
  } else {
    state.px[seat] = RING_LO;
    state.py[seat] = tileCenter(ty);
  }
  state.ghost[seat] = 1;
  state.ghostCd[seat] = GHOST_BOMB_COOLDOWN;
}

/** Tries one direction along the outer ring; returns true if the ghost moved. */
function glide(state: SimState, seat: number, dir: Direction): boolean {
  if (dir === Dir.NONE) return false;
  const x = state.px[seat] as number;
  const y = state.py[seat] as number;
  const dx = DIR_DX[dir] as number;
  const dy = DIR_DY[dir] as number;
  if (dx !== 0 && (y === RING_LO || y === RING_HI_Y)) {
    const nx = Math.min(RING_HI_X, Math.max(RING_LO, x + dx * GHOST_SPEED));
    state.px[seat] = nx;
    return nx !== x;
  }
  if (dy !== 0 && (x === RING_LO || x === RING_HI_X)) {
    const ny = Math.min(RING_HI_Y, Math.max(RING_LO, y + dy * GHOST_SPEED));
    state.py[seat] = ny;
    return ny !== y;
  }
  return false;
}

/** One ghost tick: glide (main direction, else the secondary one), cooldown, revenge bomb. */
export function updateGhost(state: SimState, seat: number, input: number, sink: EventSink): void {
  const main = inputMain(input);
  let moved = Dir.NONE as Direction;
  if (glide(state, seat, main)) moved = main;
  else if (glide(state, seat, inputSecondary(input))) moved = inputSecondary(input);
  state.moveDir[seat] = moved;
  if (main !== Dir.NONE) state.facing[seat] = main;

  const cd = state.ghostCd[seat] as number;
  if (cd > 0) {
    state.ghostCd[seat] = cd - 1;
    return;
  }
  if (!inputBomb(input)) return;
  const x = Math.min(GRID_W - 2, Math.max(1, toTile(state.px[seat] as number)));
  const y = Math.min(GRID_H - 2, Math.max(1, toTile(state.py[seat] as number)));
  const cell = cellIndex(x, y);
  if (state.tiles[cell] !== Tile.FLOOR) return;
  if (addBomb(state, x, y, seat, GHOST_BOMB_FUSE, GHOST_BOMB_RANGE, BombFlag.GHOST) < 0) return;
  state.ghostCd[seat] = GHOST_BOMB_COOLDOWN;
  sink.emit(EventKind.GHOST_BOMB, seat, cell);
}

// ---------------------------------------------------------------------------------------------
// Round end

function popcount4(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
}

/**
 * Returns the decided outcome of the round after this tick: the winning side, `NO_SIDE` for a
 * draw, or `undefined` while the round goes on. `timeUp` = the clock ran out without sudden death.
 */
export function roundOutcome(state: SimState, timeUp: boolean): number | undefined {
  let started = 0;
  let alive = 0;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s)) continue;
    const side = sideOf(state, s);
    started |= 1 << side;
    if (state.alive[s]) alive |= 1 << side;
  }
  if (started === 0) return undefined;
  const left = popcount4(alive);
  if (left === 0) return NO_SIDE;
  if (left === 1 && popcount4(started) >= 2) return 31 - Math.clz32(alive);
  return timeUp ? NO_SIDE : undefined;
}
