/**
 * Floor-mechanic constants shared by movement, bombs and `floor.ts` (kept import-free to avoid
 * module cycles). See `floor.ts` for what each mechanic does.
 */

import { Dir, type Direction } from './input';
import { FloorFx } from './state';

/** Ice glide after letting go: 2 tiles in subunits. */
export const ICE_SLIDE = 512;
/** Conveyor speed in subunits per tick. */
export const BELT_SPEED = 8;
/** A player within this Chebyshev distance (subunits) of a pad's centre is teleported. */
export const TELEPORT_WINDOW = 48;
/** Ticks between two growing pillars (and the warning before the first). */
export const GROW_INTERVAL = 20;
/** Share of the round time (percent) after which pillars start growing. */
export const GROW_AT_PERCENT = 75;

/** Direction a belt cell pushes (`Dir`), 0 for non-belt cells. */
export function beltDir(fx: number): Direction {
  return fx >= FloorFx.BELT_UP && fx <= FloorFx.BELT_LEFT ? ((fx - 1) as Direction) : Dir.NONE;
}

/** A bomb placed on, or sliding onto, a trampoline hops this many tiles. */
export const TRAMPOLINE_HOP = 2;
