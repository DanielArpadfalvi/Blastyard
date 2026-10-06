import { describe, expect, it } from 'vitest';
import { Dir, encodeInput, INPUT_BOMB } from '../../../src/core/input';
import { InputController } from '../../../src/input/controller';
import type { Rect } from '../../../src/input/geometry';
import { defaultBombCenter, TouchZones, type ZoneSpec } from '../../../src/input/zones';

/** 900 × 400 landscape screen: arena in the middle, a 200 dp strip on each side. */
const ARENA: Rect = { x: 250, y: 0, w: 400, h: 400 };
const LEFT: Rect = { x: 20, y: 20, w: 200, h: 360 };
const RIGHT: Rect = { x: 680, y: 20, w: 200, h: 360 };

function faceOff(): TouchZones {
  const zones = new TouchZones();
  zones.setLayout(
    [
      { seat: 0, rect: LEFT, orientation: 90, scheme: 'twoThumb' },
      { seat: 1, rect: RIGHT, orientation: 270, scheme: 'twoThumb' },
    ],
    ARENA,
  );
  return zones;
}

function corners(): TouchZones {
  const zones = new TouchZones();
  const top = (r: Rect): Rect => ({ ...r, h: 180 });
  const bottom = (r: Rect): Rect => ({ ...r, y: 200, h: 180 });
  zones.setLayout(
    [
      { seat: 0, rect: bottom(LEFT), orientation: 0, scheme: 'oneFinger' },
      { seat: 1, rect: top(RIGHT), orientation: 180, scheme: 'oneFinger' },
      { seat: 2, rect: top(LEFT), orientation: 180, scheme: 'oneFinger' },
      { seat: 3, rect: bottom(RIGHT), orientation: 0, scheme: 'oneFinger' },
    ],
    ARENA,
  );
  return zones;
}

function sample(zones: TouchZones): number[] {
  return [...new InputController([zones]).sample()];
}

describe('zone hit-testing', () => {
  it('assigns touches to the zone they start in', () => {
    const zones = faceOff();
    expect(zones.hitTest(100, 100)).toBe(0);
    expect(zones.hitTest(800, 300)).toBe(1);
  });

  it('ignores touches over the arena, even where a zone overlaps it', () => {
    const zones = new TouchZones();
    zones.setLayout(
      [{ seat: 0, rect: { x: 0, y: 0, w: 300, h: 400 }, orientation: 0, scheme: 'oneFinger' }],
      ARENA,
    );
    expect(zones.hitTest(260, 100)).toBe(-1);
    expect(zones.pointerDown(1, 260, 100, 0)).toBe(false);
    expect(zones.hitTest(240, 100)).toBe(0);
  });

  it('ignores touches outside every zone', () => {
    const zones = faceOff();
    expect(zones.hitTest(5, 5)).toBe(-1);
    expect(zones.hitTest(235, 200)).toBe(-1);
  });

  it('keeps a 4 mm dead band between neighbouring zones', () => {
    const zones = corners();
    const gutter = zones.gutter;
    expect(gutter).toBeCloseTo(4 * 6.3);
    // Boundary between the left corners is y = 200.
    expect(zones.hitTest(100, 200 - gutter / 2 - 0.5)).toBe(2);
    expect(zones.hitTest(100, 199)).toBe(-1);
    expect(zones.hitTest(100, 201)).toBe(-1);
    expect(zones.hitTest(100, 200 + gutter / 2 + 0.5)).toBe(0);
  });

  it('uses the caller density for the gutter', () => {
    const zones = new TouchZones({ dpPerMm: 10 });
    expect(zones.gutter).toBe(40);
  });
});

describe('two-thumb scheme', () => {
  it('places the bomb button in the seat-local bottom-right quarter', () => {
    // Left seat (faces right): its right hand is screen-down, its near edge is screen-left.
    const spec: ZoneSpec = { seat: 0, rect: LEFT, orientation: 90, scheme: 'twoThumb' };
    expect(defaultBombCenter(spec)).toEqual({ x: 20 + 50, y: 20 + 270 });
    expect(defaultBombCenter({ ...spec, leftHanded: true })).toEqual({ x: 70, y: 20 + 90 });
    const bottomSeat: ZoneSpec = { seat: 0, rect: LEFT, orientation: 0, scheme: 'twoThumb' };
    expect(defaultBombCenter(bottomSeat)).toEqual({ x: 170, y: 290 });
  });

  it('steers with a stick started in the seat-left 55%', () => {
    const zones = faceOff();
    // Seat 0's left is the screen top of its strip.
    expect(zones.pointerDown(1, 120, 100, 0)).toBe(true);
    zones.pointerMove(1, 160, 100);
    expect(sample(zones)).toEqual([encodeInput(Dir.RIGHT), 0, 0, 0]);
    zones.pointerUp(1, 160, 100, 50);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
  });

  it('reports one bomb edge per press, on the press and not the release', () => {
    const zones = faceOff();
    const bomb = defaultBombCenter({ seat: 1, rect: RIGHT, orientation: 270, scheme: 'twoThumb' });
    zones.pointerDown(7, bomb.x + 30, bomb.y - 20, 0);
    expect(sample(zones)).toEqual([0, INPUT_BOMB, 0, 0]);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    zones.pointerUp(7, bomb.x, bomb.y, 500);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    // Press and release between two ticks still counts once.
    zones.pointerDown(8, bomb.x, bomb.y, 600);
    zones.pointerUp(8, bomb.x, bomb.y, 610);
    expect(sample(zones)).toEqual([0, INPUT_BOMB, 0, 0]);
  });

  it('combines stick and bomb button of one seat', () => {
    const zones = faceOff();
    zones.pointerDown(1, 100, 80, 0);
    zones.pointerMove(1, 100, 30);
    zones.pointerDown(2, 70, 290, 10);
    expect(sample(zones)).toEqual([encodeInput(Dir.UP, Dir.NONE, true), 0, 0, 0]);
  });

  it('ignores touches in the seat-right part outside the bomb button', () => {
    const zones = faceOff();
    // Seat-right 45% of the left strip is screen y > 20 + 0.55 × 360 = 218.
    expect(zones.pointerDown(1, 200, 240, 0)).toBe(true);
    zones.pointerMove(1, 200, 160);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
  });

  it('uses only the first finger in the stick part', () => {
    const zones = faceOff();
    zones.pointerDown(1, 100, 100, 0);
    zones.pointerDown(2, 150, 150, 0);
    zones.pointerMove(2, 150, 50);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    zones.pointerMove(1, 60, 100);
    expect(sample(zones)).toEqual([encodeInput(Dir.LEFT), 0, 0, 0]);
  });
});

describe('touch ownership', () => {
  it('keeps a touch bound to its start zone when it slides into another zone or the arena', () => {
    const zones = faceOff();
    zones.pointerDown(1, 100, 100, 0);
    zones.pointerMove(1, 450, 100); // over the arena
    expect(sample(zones)).toEqual([encodeInput(Dir.RIGHT), 0, 0, 0]);
    zones.pointerMove(1, 800, 100); // over seat 1's zone
    expect(sample(zones)).toEqual([encodeInput(Dir.RIGHT), 0, 0, 0]);
    // A new touch in seat 1's zone still belongs to seat 1.
    zones.pointerDown(2, 760, 300, 0);
    zones.pointerMove(2, 760, 350);
    expect(sample(zones)[1]).toBe(encodeInput(Dir.DOWN));
    zones.pointerUp(1, 800, 100, 100);
    expect(sample(zones)[0]).toBe(0);
  });

  it('ignores a touch that started over the arena for its whole life', () => {
    const zones = faceOff();
    expect(zones.pointerDown(1, 450, 200, 0)).toBe(false);
    zones.pointerMove(1, 100, 100);
    zones.pointerMove(1, 150, 100);
    zones.pointerUp(1, 150, 100, 10);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    expect(zones.activePointers).toBe(0);
  });

  it('drives two zones at once', () => {
    const zones = faceOff();
    zones.pointerDown(1, 100, 100, 0);
    zones.pointerDown(2, 760, 300, 0);
    zones.pointerMove(1, 100, 150);
    zones.pointerMove(2, 720, 300);
    expect(sample(zones)).toEqual([encodeInput(Dir.DOWN), encodeInput(Dir.LEFT), 0, 0]);
  });

  it('cancel releases without a bomb, and setLayout drops active touches', () => {
    const zones = corners();
    zones.pointerDown(1, 100, 300, 0);
    zones.pointerCancel(1);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    zones.pointerDown(2, 100, 300, 0);
    zones.pointerMove(2, 140, 300);
    zones.setLayout([], null);
    zones.pointerUp(2, 140, 300, 50);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
  });
});

describe('one-finger scheme', () => {
  it('a short still tap is a bomb (on release)', () => {
    const zones = corners();
    zones.pointerDown(1, 100, 300, 1000);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    zones.pointerMove(1, 105, 303);
    zones.pointerUp(1, 105, 303, 1179);
    expect(sample(zones)).toEqual([INPUT_BOMB, 0, 0, 0]);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
  });

  it('a long press or a drag is not a tap', () => {
    const zones = corners();
    zones.pointerDown(1, 100, 300, 0);
    zones.pointerUp(1, 100, 300, 180);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
    // Moved 12 dp away and back: travel counts the farthest point.
    zones.pointerDown(2, 100, 300, 1000);
    zones.pointerMove(2, 112, 300);
    zones.pointerUp(2, 100, 300, 1050);
    expect(sample(zones)).toEqual([0, 0, 0, 0]);
  });

  it('the whole zone is a floating stick', () => {
    const zones = corners();
    zones.pointerDown(1, 840, 40, 0); // seat 1 (top right), far corner of its zone
    zones.pointerMove(1, 840, 90);
    expect(sample(zones)).toEqual([0, encodeInput(Dir.DOWN), 0, 0]);
  });

  it('a second finger while steering is a bomb on its press edge', () => {
    const zones = corners();
    zones.pointerDown(1, 60, 300, 0);
    zones.pointerMove(1, 60, 250);
    zones.pointerDown(2, 180, 340, 400);
    expect(sample(zones)).toEqual([encodeInput(Dir.UP, Dir.NONE, true), 0, 0, 0]);
    // The second finger does not steer, and lifting it is not another bomb.
    zones.pointerMove(2, 180, 390);
    zones.pointerUp(2, 180, 390, 450);
    expect(sample(zones)).toEqual([encodeInput(Dir.UP), 0, 0, 0]);
  });

  it('serves four corner seats independently', () => {
    const zones = corners();
    zones.pointerDown(1, 100, 300, 0); // seat 0
    zones.pointerDown(2, 800, 100, 0); // seat 1
    zones.pointerDown(3, 100, 100, 0); // seat 2
    zones.pointerDown(4, 800, 300, 0); // seat 3
    zones.pointerMove(1, 140, 300);
    zones.pointerMove(2, 760, 100);
    zones.pointerMove(3, 100, 60);
    zones.pointerUp(4, 800, 300, 50);
    expect(sample(zones)).toEqual([
      encodeInput(Dir.RIGHT),
      encodeInput(Dir.LEFT),
      encodeInput(Dir.UP),
      INPUT_BOMB,
    ]);
  });
});
