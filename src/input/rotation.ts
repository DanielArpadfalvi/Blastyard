import { Dir, type Direction } from '../core/input';
import type { Rect } from './geometry';

/**
 * Seat orientation (PLAN §1.3): the screen direction a seated player's "forward" (away from them)
 * points to, in degrees clockwise from screen-up.
 * - 0: player sits at the bottom edge, forward = screen up
 * - 90: player sits at the left edge, forward = screen right
 * - 180: player sits at the top edge, forward = screen down
 * - 270: player sits at the right edge, forward = screen left
 *
 * Seat-local frame: +x = the player's right hand, +y = towards the player (so -y is forward),
 * matching screen axes when the orientation is 0.
 *
 * What gets rotated: a finger dragged on the glass already moves in screen (= arena/world)
 * space, so a floating stick needs no rotation – pushing "away from you" moves the Puff away from
 * you from any side of the table. The orientation decides where the seat-relative parts of a
 * zone are (stick half, bomb button, left-handed swap) and maps relative devices (keyboard,
 * gamepad, fixed D-pad) from the player's frame into the world.
 */
export type SeatOrientation = 0 | 90 | 180 | 270;

export const SEAT_ORIENTATIONS: readonly SeatOrientation[] = [0, 90, 180, 270];

/** Lobby: tapping the zone arrow turns the seat by 90° clockwise. */
export function nextOrientation(o: SeatOrientation): SeatOrientation {
  return ((o + 90) % 360) as SeatOrientation;
}

export interface Vec {
  x: number;
  y: number;
}

/** Rotates a seat-local vector into screen/world space. */
export function localToScreen(x: number, y: number, o: SeatOrientation): Vec {
  switch (o) {
    case 0:
      return { x, y };
    case 90:
      return { x: -y, y: x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: y, y: -x };
  }
}

/** Inverse of {@link localToScreen}. */
export function screenToLocal(x: number, y: number, o: SeatOrientation): Vec {
  switch (o) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: -x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: -y, y: x };
  }
}

/** Rotates a seat-local direction (e.g. "forward" = UP) into the world direction. */
export function rotateDirection(dir: Direction, o: SeatOrientation): Direction {
  if (dir === Dir.NONE) return Dir.NONE;
  // UP, RIGHT, DOWN, LEFT are 1..4 in clockwise order, so 90° = one step.
  const steps = o / 90;
  return (((dir - 1 + steps) % 4) + 1) as Direction;
}

/** Size of a zone in its seat-local frame (width/height swap for 90/270). */
export function localSize(rect: Rect, o: SeatOrientation): { w: number; h: number } {
  return o === 90 || o === 270 ? { w: rect.h, h: rect.w } : { w: rect.w, h: rect.h };
}

/**
 * A screen point as seat-local coordinates inside `rect`: `x` from the player's left edge of the
 * zone, `y` from the far edge (0) to the near edge (local height).
 */
export function zoneLocalPoint(rect: Rect, o: SeatOrientation, sx: number, sy: number): Vec {
  const dx = sx - rect.x;
  const dy = sy - rect.y;
  switch (o) {
    case 0:
      return { x: dx, y: dy };
    case 90:
      // Player at the left edge: their left is screen top, the far edge is screen right.
      return { x: dy, y: rect.w - dx };
    case 180:
      return { x: rect.w - dx, y: rect.h - dy };
    case 270:
      return { x: rect.h - dy, y: dx };
  }
}

/** Inverse of {@link zoneLocalPoint}: seat-local zone coordinates back to the screen. */
export function zoneScreenPoint(rect: Rect, o: SeatOrientation, lx: number, ly: number): Vec {
  switch (o) {
    case 0:
      return { x: rect.x + lx, y: rect.y + ly };
    case 90:
      return { x: rect.x + rect.w - ly, y: rect.y + lx };
    case 180:
      return { x: rect.x + rect.w - lx, y: rect.y + rect.h - ly };
    case 270:
      return { x: rect.x + ly, y: rect.y + rect.h - lx };
  }
}
