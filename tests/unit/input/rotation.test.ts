import { describe, expect, it } from 'vitest';
import { Dir } from '../../../src/core/input';
import {
  localSize,
  localToScreen,
  nextOrientation,
  rotateDirection,
  SEAT_ORIENTATIONS,
  screenToLocal,
  zoneLocalPoint,
  zoneScreenPoint,
} from '../../../src/input/rotation';
import type { Rect } from '../../../src/input/geometry';

const FORWARD = { x: 0, y: -1 };
const RIGHT_HAND = { x: 1, y: 0 };

describe('seat rotation', () => {
  it('maps the player forward direction onto the screen for each seat', () => {
    expect(localToScreen(FORWARD.x, FORWARD.y, 0)).toEqual({ x: 0, y: -1 });
    expect(localToScreen(FORWARD.x, FORWARD.y, 90)).toEqual({ x: 1, y: 0 });
    expect(localToScreen(FORWARD.x, FORWARD.y, 180)).toEqual({ x: -0, y: 1 });
    expect(localToScreen(FORWARD.x, FORWARD.y, 270)).toEqual({ x: -1, y: -0 });
  });

  it('keeps the right hand clockwise of forward', () => {
    // Player at the left edge faces right: their right hand points down the screen.
    expect(localToScreen(RIGHT_HAND.x, RIGHT_HAND.y, 90)).toEqual({ x: -0, y: 1 });
    expect(localToScreen(RIGHT_HAND.x, RIGHT_HAND.y, 270)).toEqual({ x: 0, y: -1 });
  });

  it('screenToLocal inverts localToScreen', () => {
    for (const o of SEAT_ORIENTATIONS) {
      const s = localToScreen(3, -7, o);
      const back = screenToLocal(s.x, s.y, o);
      expect(back.x + 0).toBe(3);
      expect(back.y + 0).toBe(-7);
    }
  });

  it('rotates directions like vectors', () => {
    // Indexed by Direction (0 = NONE).
    const vec: [number, number][] = [
      [0, 0],
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    for (const o of SEAT_ORIENTATIONS) {
      for (const dir of [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]) {
        const [x, y] = vec[dir] as [number, number];
        const s = localToScreen(x, y, o);
        expect(vec[rotateDirection(dir, o)]).toEqual([s.x + 0, s.y + 0]);
      }
      expect(rotateDirection(Dir.NONE, o)).toBe(Dir.NONE);
    }
    expect(rotateDirection(Dir.UP, 90)).toBe(Dir.RIGHT);
    expect(rotateDirection(Dir.LEFT, 180)).toBe(Dir.RIGHT);
    expect(rotateDirection(Dir.UP, 270)).toBe(Dir.LEFT);
  });

  it('cycles orientations by 90° steps', () => {
    expect(nextOrientation(0)).toBe(90);
    expect(nextOrientation(90)).toBe(180);
    expect(nextOrientation(180)).toBe(270);
    expect(nextOrientation(270)).toBe(0);
  });
});

describe('zone-local coordinates', () => {
  const rect: Rect = { x: 10, y: 20, w: 200, h: 300 };

  it('swaps the local size for side seats', () => {
    expect(localSize(rect, 0)).toEqual({ w: 200, h: 300 });
    expect(localSize(rect, 90)).toEqual({ w: 300, h: 200 });
    expect(localSize(rect, 180)).toEqual({ w: 200, h: 300 });
    expect(localSize(rect, 270)).toEqual({ w: 300, h: 200 });
  });

  it('puts the player-left / far corner where the seat expects it', () => {
    // Seat at the bottom: far-left = screen top-left.
    expect(zoneLocalPoint(rect, 0, 10, 20)).toEqual({ x: 0, y: 0 });
    // Seat at the left edge: their far-left is the screen top-right of the zone.
    expect(zoneLocalPoint(rect, 90, 210, 20)).toEqual({ x: 0, y: 0 });
    // Seat at the top: far-left is screen bottom-right.
    expect(zoneLocalPoint(rect, 180, 210, 320)).toEqual({ x: 0, y: 0 });
    // Seat at the right edge: far-left is screen bottom-left.
    expect(zoneLocalPoint(rect, 270, 10, 320)).toEqual({ x: 0, y: 0 });
    // Near edge for the left seat is the screen-left side of the zone.
    expect(zoneLocalPoint(rect, 90, 10, 20).y).toBe(200);
  });

  it('zoneScreenPoint inverts zoneLocalPoint', () => {
    for (const o of SEAT_ORIENTATIONS) {
      for (const [sx, sy] of [
        [10, 20],
        [57, 233],
        [209, 319],
      ]) {
        const l = zoneLocalPoint(rect, o, sx as number, sy as number);
        expect(zoneScreenPoint(rect, o, l.x, l.y)).toEqual({ x: sx, y: sy });
      }
    }
  });
});
