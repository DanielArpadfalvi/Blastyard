/**
 * Scene extraction: turns the (read-only) simulation state into a flat, preallocated description
 * of what to draw this frame – interpolated positions, fuse progress, flame shapes, animation
 * phases. Pure and Pixi-free so it is unit-tested; the Pixi view (`arenaView.ts`) only copies
 * these numbers onto pooled sprites.
 *
 * Animation time is `tick + alpha` (sim ticks), never the wall clock, so a paused or replayed
 * frame always looks the same.
 */

import {
  BombFlag,
  CELL_COUNT,
  FLAME_TICKS,
  FUSE_TICKS,
  GHOST_BOMB_FUSE,
  GRID_H,
  GRID_W,
  Hdr,
  MAX_BOMBS,
  MAX_SEATS,
  NO_SIDE,
  Phase,
  RuleFlag,
  TILE,
  Tile,
} from '../core';
import type { TickHistory } from './interpolation';
import { bombPrevIndexValid, interpolateCoord } from './interpolation';
import type { ReadonlySimState } from './readonlyState';

/** Flame arm bits (towards a burning neighbour). */
export const Arm = { UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8 } as const;

/** A bomb this close to going off scares Puffs standing in its blast line. */
export const SCARE_FUSE_TICKS = 60;
/** Blink length and period (ticks). */
export const BLINK_TICKS = 7;
export const BLINK_PERIOD = 200;

/** Eye texture variants: 0 = looking at the viewer, 1–4 = `Dir` up/right/down/left, blink, scared. */
export const EYE_BLINK = 5;
export const EYE_SCARED = 6;
export const EYE_VARIANTS = 7;

/** A pop blinks white during its final half second (matches the fuse beeps). */
export const HOT_FUSE_TICKS = 30;
/** Pop-in animation length after a pop is placed (ticks). */
export const POP_IN_TICKS = 8;

export interface PlayerView {
  visible: boolean;
  ghost: boolean;
  /** Centre in tiles (grid coordinates, cell 0 = outer wall). */
  x: number;
  y: number;
  /** Last facing direction (`Dir`). */
  facing: number;
  moving: boolean;
  scared: boolean;
  blink: boolean;
  /** Squash & stretch scale factors. */
  scaleX: number;
  scaleY: number;
  /** Vertical hop offset in tiles (negative = up). */
  hop: number;
  /** Body tilt in radians (victory dance). */
  rotation: number;
  /** Won the round: dances with happy eyes. */
  victory: boolean;
}

export interface BombView {
  x: number;
  y: number;
  /** Remaining fuse as a fraction of the full fuse, 0–1. */
  fuse: number;
  ghost: boolean;
  owner: number;
  /** Pulse scale (faster and stronger as the fuse runs out) times the pop-in scale. */
  pulse: number;
  /** Final half second: drawn with a white blink. */
  hot: boolean;
}

export interface FlameView {
  cell: number;
  /** `Arm` bits towards burning neighbours. */
  arms: number;
  /** Remaining flame life 0–1 (fades out). */
  strength: number;
}

/** Everything the renderer draws in one frame. Allocated once, refilled every frame. */
export class Scene {
  tick = 0;
  /** Fraction of a tick past `tick`, 0–1. */
  alpha = 0;
  phase = 0;
  readonly tiles = new Uint8Array(CELL_COUNT);
  readonly pickups = new Uint8Array(CELL_COUNT);
  readonly players: PlayerView[] = Array.from({ length: MAX_SEATS }, () => ({
    visible: false,
    ghost: false,
    x: 0,
    y: 0,
    facing: 0,
    moving: false,
    scared: false,
    blink: false,
    scaleX: 1,
    scaleY: 1,
    hop: 0,
    rotation: 0,
    victory: false,
  }));
  readonly bombs: BombView[] = Array.from({ length: MAX_BOMBS }, () => ({
    x: 0,
    y: 0,
    fuse: 1,
    ghost: false,
    owner: 0,
    pulse: 1,
    hot: false,
  }));
  bombCount = 0;
  readonly flames: FlameView[] = Array.from({ length: CELL_COUNT }, () => ({
    cell: 0,
    arms: 0,
    strength: 0,
  }));
  flameCount = 0;
}

/** Arm bits of a burning cell: one per burning orthogonal neighbour. */
export function flameArms(state: ReadonlySimState, cell: number): number {
  const x = cell % GRID_W;
  const y = (cell - x) / GRID_W;
  let arms = 0;
  if (y > 0 && (state.flame[cell - GRID_W] as number) > 0) arms |= Arm.UP;
  if (x < GRID_W - 1 && (state.flame[cell + 1] as number) > 0) arms |= Arm.RIGHT;
  if (y < GRID_H - 1 && (state.flame[cell + GRID_W] as number) > 0) arms |= Arm.DOWN;
  if (x > 0 && (state.flame[cell - 1] as number) > 0) arms |= Arm.LEFT;
  return arms;
}

/** Remaining fuse fraction of bomb `b` (ghost bombs have their own fuse length). */
export function fuseFraction(state: ReadonlySimState, b: number): number {
  const ghost = ((state.bombFlags[b] as number) & BombFlag.GHOST) !== 0;
  const full = ghost ? GHOST_BOMB_FUSE : FUSE_TICKS;
  const f = (state.bombFuse[b] as number) / full;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** Pulse scale of a pop: a slow throb that speeds up as the fuse burns down. */
export function popPulse(fuse: number, time: number): number {
  const rate = 0.12 + (1 - fuse) * 0.38;
  const depth = 0.04 + (1 - fuse) * 0.08;
  return 1 + depth * Math.sin(time * rate * Math.PI);
}

/**
 * Pop-in scale of a freshly placed pop `age` ticks after placement: grows from 60 % with a small
 * overshoot (squash & stretch), 1 afterwards.
 */
export function popInScale(age: number): number {
  if (age >= POP_IN_TICKS) return 1;
  if (age <= 0) return 0.6;
  const p = age / POP_IN_TICKS;
  return 0.6 + 0.4 * p + 0.22 * Math.sin(p * Math.PI);
}

/** True if `seat` belongs to the side that won the round that just ended. */
export function isRoundWinner(state: ReadonlySimState, seat: number): boolean {
  const phase = state.hdr[Hdr.PHASE] as number;
  if (phase !== Phase.ROUND_OVER && phase !== Phase.MATCH_OVER) return false;
  const winner = state.hdr[Hdr.ROUND_WINNER] as number;
  if (winner === NO_SIDE || (state.alive[seat] as number) === 0) return false;
  const teams = ((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.TEAMS) !== 0;
  return (teams ? (state.team[seat] as number) : seat) === winner;
}

/** Deterministic blink: a few ticks every `BLINK_PERIOD`, phase-shifted per seat. */
export function isBlinking(tick: number, seat: number): boolean {
  return (tick + seat * 53) % BLINK_PERIOD < BLINK_TICKS;
}

/**
 * True if the Puff at tile (tx, ty) has a flame next to it (8-neighbourhood) or stands in the
 * blast line of a pop that is about to go off.
 */
export function isScared(state: ReadonlySimState, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      if ((state.flame[y * GRID_W + x] as number) > 0) return true;
    }
  }
  const n = state.hdr[Hdr.BOMB_COUNT] as number;
  for (let b = 0; b < n; b++) {
    if ((state.bombFuse[b] as number) > SCARE_FUSE_TICKS) continue;
    const bx = Math.floor((state.bombX[b] as number) / TILE);
    const by = Math.floor((state.bombY[b] as number) / TILE);
    const reach = state.bombRange[b] as number;
    if ((bx === tx && Math.abs(by - ty) <= reach) || (by === ty && Math.abs(bx - tx) <= reach)) {
      return true;
    }
  }
  return false;
}

function fillPlayer(
  out: PlayerView,
  state: ReadonlySimState,
  history: TickHistory,
  seat: number,
  alpha: number,
  time: number,
  interpolate: boolean,
): void {
  const active = ((state.hdr[Hdr.SEAT_MASK] as number) & (1 << seat)) !== 0;
  const alive = (state.alive[seat] as number) !== 0;
  const ghost = !alive && (state.ghost[seat] as number) !== 0;
  out.visible = active && (alive || ghost);
  out.ghost = ghost;
  if (!out.visible) return;
  const cx = state.px[seat] as number;
  const cy = state.py[seat] as number;
  const x = interpolate ? interpolateCoord(history.px[seat] as number, cx, alpha) : cx;
  const y = interpolate ? interpolateCoord(history.py[seat] as number, cy, alpha) : cy;
  out.x = x / TILE;
  out.y = y / TILE;
  out.facing = state.facing[seat] as number;
  out.moving = (state.moveDir[seat] as number) !== 0;
  const tick = state.hdr[Hdr.TICK] as number;
  out.blink = isBlinking(tick, seat);
  out.scared = alive && isScared(state, Math.floor(cx / TILE), Math.floor(cy / TILE));
  const phase = time + seat * 17;
  out.victory = alive && isRoundWinner(state, seat);
  out.rotation = 0;
  if (out.victory) {
    // Victory dance: bouncy hops with a side-to-side wiggle.
    const s = Math.sin(phase * 0.5);
    out.hop = -0.22 * Math.abs(Math.sin(phase * 0.25));
    out.scaleX = 1 - 0.08 * s;
    out.scaleY = 1 + 0.08 * s;
    out.rotation = 0.2 * Math.sin(phase * 0.125);
  } else if (ghost) {
    // Ghosts float: slow vertical bob, no squash.
    out.scaleX = 1;
    out.scaleY = 1;
    out.hop = -0.06 + 0.05 * Math.sin(phase * 0.08);
  } else if (out.moving) {
    // Hopping walk: squash on landing, stretch in the air.
    const s = Math.sin(phase * 0.42);
    out.scaleX = 1 + 0.07 * s;
    out.scaleY = 1 - 0.07 * s;
    out.hop = -0.08 * Math.abs(Math.sin(phase * 0.21));
  } else {
    const s = Math.sin(phase * 0.07);
    out.scaleX = 1 + 0.025 * s;
    out.scaleY = 1 - 0.025 * s;
    out.hop = 0;
  }
}

/**
 * Fills `out` from `state` (never written) and the previous tick in `history`. `alpha` is the
 * fraction of a tick elapsed since the latest step; interpolation is skipped when `history` is
 * not exactly one tick behind.
 */
export function extractScene(
  state: ReadonlySimState,
  history: TickHistory,
  alpha: number,
  out: Scene,
): Scene {
  const tick = state.hdr[Hdr.TICK] as number;
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  const interpolate = history.isPreviousOf(state);
  const time = tick + a;
  out.tick = tick;
  out.alpha = a;
  out.phase = state.hdr[Hdr.PHASE] as number;

  for (let c = 0; c < CELL_COUNT; c++) {
    out.tiles[c] = state.tiles[c] as number;
    out.pickups[c] = (state.tiles[c] as number) === Tile.FLOOR ? (state.pickup[c] as number) : 0;
  }

  for (let s = 0; s < MAX_SEATS; s++) {
    fillPlayer(out.players[s] as PlayerView, state, history, s, a, time, interpolate);
  }

  const n = state.hdr[Hdr.BOMB_COUNT] as number;
  for (let b = 0; b < n; b++) {
    const view = out.bombs[b] as BombView;
    const owner = state.bombOwner[b] as number;
    const bx = state.bombX[b] as number;
    const by = state.bombY[b] as number;
    const lerpOk = interpolate && bombPrevIndexValid(history, b, owner);
    view.x = (lerpOk ? interpolateCoord(history.bombX[b] as number, bx, a) : bx) / TILE;
    view.y = (lerpOk ? interpolateCoord(history.bombY[b] as number, by, a) : by) / TILE;
    view.fuse = fuseFraction(state, b);
    view.ghost = ((state.bombFlags[b] as number) & BombFlag.GHOST) !== 0;
    view.owner = owner;
    const fuseTicks = state.bombFuse[b] as number;
    const full = view.ghost ? GHOST_BOMB_FUSE : FUSE_TICKS;
    view.pulse = popPulse(view.fuse, time + b * 7) * popInScale(full - fuseTicks + a);
    view.hot = fuseTicks <= HOT_FUSE_TICKS && Math.floor(time / 4) % 2 === 0;
  }
  out.bombCount = n;

  let f = 0;
  for (let c = 0; c < CELL_COUNT; c++) {
    const life = state.flame[c] as number;
    if (life === 0) continue;
    const view = out.flames[f++] as FlameView;
    view.cell = c;
    view.arms = flameArms(state, c);
    view.strength = Math.min(1, life / FLAME_TICKS);
  }
  out.flameCount = f;
  return out;
}

/** Fuse ring frame for a remaining-fuse fraction (0 … `frames`); a lit pop always shows a spark. */
export function fuseFrame(fuse: number, frames: number): number {
  if (fuse <= 0) return 0;
  return Math.max(1, Math.min(frames, Math.ceil(fuse * frames)));
}

/** Eye variant for a Puff: blink / victory (happy) > scared > facing direction (see `EYE_*`). */
export function eyeVariant(view: PlayerView): number {
  if (view.blink || view.victory) return EYE_BLINK;
  if (view.scared) return EYE_SCARED;
  return view.facing >= 1 && view.facing <= 4 ? view.facing : 0;
}
