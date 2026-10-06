import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN } from '../../../src/content/arenas/classic';
import { createState, Hdr } from '../../../src/core';
import { rectContains } from '../../../src/input/geometry';
import { defaultBombCenter, TouchZones } from '../../../src/input/zones';
import {
  ZONE_EDGE_MM,
  keyBindingsFor,
  matchSetupFor,
  seatPlan,
  zonesFor,
} from '../../../src/game/modes';
import { solveLayout } from '../../../src/render/layout';

const SCREENS = [
  { width: 1600, height: 720 },
  { width: 2400, height: 1080 },
  { width: 2048, height: 1536 },
  { width: 915, height: 412 },
];

describe('modes', () => {
  it('seat plans: solo = human vs bot, face-off = two humans facing each other', () => {
    expect(seatPlan('solo').map((p) => p.kind)).toEqual(['human', 'bot', 'off', 'off']);
    expect(seatPlan('faceoff').map((p) => [p.kind, p.orientation])).toEqual([
      ['human', 90],
      ['human', 270],
      ['off', 0],
      ['off', 0],
    ]);
    expect(seatPlan('attract').every((p) => p.kind === 'bot')).toBe(true);
  });

  it('match setup activates exactly the planned seats with the requested wins', () => {
    const setup = matchSetupFor('solo', { seed: 4, arena: ARENA_GARDEN, winsToMatch: 2 });
    expect(setup.seats).toEqual([true, true, false, false]);
    const s = createState(setup);
    expect(s.hdr[Hdr.SEAT_MASK]).toBe(0b11);
    expect(s.hdr[Hdr.WINS_TO_MATCH]).toBe(2);
  });

  it('keyboard: solo maps both key sets to seat 0, face-off one set per seat', () => {
    expect(keyBindingsFor('solo').map((b) => b.seat)).toEqual([0, 0]);
    expect(keyBindingsFor('faceoff').map((b) => b.seat)).toEqual([0, 1]);
    expect(keyBindingsFor('attract')).toEqual([]);
  });

  for (const screen of SCREENS) {
    it(`face-off zones sit in the strips, off the arena and the screen edges (${screen.width}×${screen.height})`, () => {
      const layout = solveLayout(screen);
      const plan = zonesFor('faceoff', layout);
      const edge = ZONE_EDGE_MM * layout.dpPerMm;
      const [left, right] = plan.zones;
      expect(left!.seat).toBe(0);
      expect(right!.seat).toBe(1);
      expect(left!.rect.x).toBeCloseTo(edge);
      expect(left!.rect.x + left!.rect.w).toBeLessThan(layout.arena.x);
      expect(right!.rect.x).toBeGreaterThan(layout.arena.x + layout.arena.w);
      expect(right!.rect.x + right!.rect.w).toBeCloseTo(screen.width - edge);
      for (const z of plan.zones) {
        expect(z.rect.y).toBeCloseTo(edge);
        expect(z.rect.w).toBeGreaterThan(100);
        // Bomb button and stick hint stay inside the zone.
        const bomb = defaultBombCenter(z);
        expect(rectContains(z.rect, bomb.x, bomb.y)).toBe(true);
      }
      plan.stickHints.forEach((h, i) => {
        expect(rectContains(plan.zones[i]!.rect, h.x, h.y)).toBe(true);
      });
    });

    it(`solo: stick starts in the left strip, bomb button in the right one (${screen.width}×${screen.height})`, () => {
      const layout = solveLayout(screen);
      const plan = zonesFor('solo', layout);
      const zones = new TouchZones({ dpPerMm: layout.dpPerMm });
      zones.setLayout(plan.zones, plan.arena);
      const frames = [0, 1, 2, 3].map(() => ({ main: 0, secondary: 0, bomb: false }));
      // A touch in the left strip starts the stick, one over the arena is ignored.
      expect(zones.pointerDown(1, plan.left.x + plan.left.w / 2, plan.left.y + 80, 0)).toBe(true);
      expect(zones.views()[0]!.stickActive).toBe(true);
      expect(zones.pointerDown(2, screen.width / 2, screen.height / 2, 0)).toBe(false);
      const bomb = plan.zones[0]!.bombCenter!;
      expect(rectContains(plan.right, bomb.x, bomb.y)).toBe(true);
      expect(zones.pointerDown(3, bomb.x, bomb.y, 0)).toBe(true);
      zones.contribute(frames as never);
      expect(frames[0]!.bomb).toBe(true);
    });
  }

  it('attract mode has no zones', () => {
    expect(zonesFor('attract', solveLayout({ width: 1600, height: 720 })).zones).toEqual([]);
  });
});
