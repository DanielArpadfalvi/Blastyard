import { describe, expect, it } from 'vitest';
import {
  ARENA_HEIGHT_FRACTION,
  DP_PER_MM,
  HUD_DP,
  INTERIOR,
  MIN_STRIP_MM,
  gridToScreen,
  solveLayout,
  type ArenaLayout,
} from '../../../src/render/layout';

function expectOnScreen(l: ArenaLayout): void {
  expect(l.arena.x).toBeGreaterThanOrEqual(0);
  expect(l.arena.y).toBeGreaterThanOrEqual(0);
  expect(l.arena.x + l.arena.w).toBeLessThanOrEqual(l.width);
  expect(l.arena.y + l.arena.h).toBeLessThanOrEqual(l.height);
}

function expectConsistent(l: ArenaLayout): void {
  expect(l.arena.w).toBe(l.arena.h);
  expect(Number.isInteger(l.tile)).toBe(true);
  expect(Number.isInteger(l.wall)).toBe(true);
  expect(l.arena.w).toBe(INTERIOR * l.tile + 2 * l.wall);
  expect(l.interior.x).toBe(l.arena.x + l.wall);
  expect(l.interior.w).toBe(INTERIOR * l.tile);
  // Strips touch the arena and never overlap it.
  expect(l.leftStrip.x + l.leftStrip.w).toBe(l.arena.x);
  expect(l.rightStrip.x).toBe(l.arena.x + l.arena.w);
}

describe('solveLayout (PLAN §1.5)', () => {
  // The three T2.1 acceptance screens (CSS px at 1× DPR) plus real phone / tablet viewports.
  const screens: ReadonlyArray<readonly [string, number, number]> = [
    ['2400×1080 (20:9 phone, native px)', 2400, 1080],
    ['1600×720 (20:9 phone)', 1600, 720],
    ['2048×1536 (4:3 tablet)', 2048, 1536],
    ['915×412 (Pixel 7 landscape dp)', 915, 412],
    ['844×390 (iPhone 14 landscape pt)', 844, 390],
    ['1024×768 (iPad landscape pt)', 1024, 768],
    ['640×360 (small Android)', 640, 360],
  ];

  for (const [name, width, height] of screens) {
    it(`${name}: full arena on screen, strips ≥ 38 mm`, () => {
      const l = solveLayout({ width, height });
      expectOnScreen(l);
      expectConsistent(l);
      expect(l.stripMm).toBeGreaterThanOrEqual(MIN_STRIP_MM);
      expect(l.leftStrip.w).toBeGreaterThanOrEqual(0.22 * width - 1);
      expect(l.arena.h).toBeLessThanOrEqual(ARENA_HEIGHT_FRACTION * height - HUD_DP);
      // The arena is centred horizontally (±1 px rounding).
      expect(Math.abs(l.leftStrip.w - l.rightStrip.w)).toBeLessThanOrEqual(1);
      // And clears the top HUD band.
      expect(l.arena.y).toBeGreaterThanOrEqual(HUD_DP);
    });
  }

  it('uses the height on wide phones and the width rule on 4:3 tablets', () => {
    const phone = solveLayout({ width: 1600, height: 720 });
    // Height-bound: within one tile of 0.94 × H − HUD.
    expect(0.94 * 720 - HUD_DP - phone.arena.h).toBeLessThan(phone.tile + 2);
    const tablet = solveLayout({ width: 2048, height: 1536 });
    // Width-bound: arena ≈ 0.75 × height, strips = 22 % of the width.
    expect(tablet.arena.h / 1536).toBeGreaterThan(0.72);
    expect(tablet.arena.h / 1536).toBeLessThan(0.76);
    expect(tablet.leftStrip.w / 2048).toBeGreaterThanOrEqual(0.22);
  });

  it('gives a 6.5" phone ≈ 44 mm strips and ≈ 5 mm tiles', () => {
    const l = solveLayout({ width: 915, height: 412 });
    expect(l.stripMm).toBeGreaterThan(40);
    expect(l.stripMm).toBeLessThan(50);
    expect(l.tileMm).toBeGreaterThan(4.3);
    expect(l.tileMm).toBeLessThan(5.6);
  });

  it('draws the outer wall as a 0.4-tile band', () => {
    const l = solveLayout({ width: 1600, height: 720 });
    expect(l.wall).toBe(Math.round(l.tile * 0.4));
  });

  it('keeps the strips clear of the safe-area insets', () => {
    const safe = { top: 0, right: 0, bottom: 21, left: 47 };
    const l = solveLayout({ width: 844, height: 390, safe });
    expectOnScreen(l);
    expect(l.leftStrip.x).toBe(47);
    expect(l.leftStrip.w).toBeGreaterThanOrEqual(MIN_STRIP_MM * DP_PER_MM);
    expect(l.rightStrip.w).toBeGreaterThanOrEqual(MIN_STRIP_MM * DP_PER_MM);
    expect(l.arena.y + l.arena.h).toBeLessThanOrEqual(390 - 21);
  });

  it('honours a measured dp-per-mm density', () => {
    const dense = solveLayout({ width: 1600, height: 720, dpPerMm: 9 });
    expect(dense.stripMm).toBeGreaterThanOrEqual(MIN_STRIP_MM);
    expect(dense.dpPerMm).toBe(9);
  });

  it('never returns NaN or negative geometry for degenerate viewports', () => {
    for (const [w, h] of [
      [360, 640],
      [0, 0],
      [Number.NaN, 500],
      [300, 100],
    ] as const) {
      const l = solveLayout({ width: w, height: h });
      expect(l.tile).toBeGreaterThan(0);
      for (const v of [l.arena.x, l.arena.y, l.arena.w, l.leftStrip.w, l.rightStrip.w]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is pure: same input, same output', () => {
    expect(solveLayout({ width: 1234, height: 567 })).toEqual(
      solveLayout({ width: 1234, height: 567 }),
    );
  });
});

describe('gridToScreen', () => {
  const l = solveLayout({ width: 1600, height: 720 });

  it('maps interior cell 1 to the interior origin and cell 12 to its far edge', () => {
    expect(gridToScreen(l, 1, 'x')).toBe(l.interior.x);
    expect(gridToScreen(l, 12, 'y')).toBe(l.interior.y + l.interior.h);
    expect(gridToScreen(l, 6.5, 'x')).toBe(l.interior.x + 5.5 * l.tile);
  });

  it('puts outer-wall cell centres (ghosts) over the thin wall band', () => {
    const x = gridToScreen(l, 0.5, 'x');
    expect(x).toBeLessThan(l.interior.x);
    expect(x).toBeGreaterThan(l.arena.x - l.tile);
  });
});
