import { describe, expect, it } from 'vitest';
import {
  HATS,
  POP_SKINS,
  PUFFS,
  SEAT_BADGES,
  TRAILS,
  defaultAppearance,
  hatIndex,
  popSkinIndex,
  puffIndex,
  tierOf,
  trailIndex,
} from '../../../src/content/cosmetics';
import { ALL_ARENAS, FREE_ARENAS, PLUS_ARENAS } from '../../../src/content/arenas';
import { SEAT_COLORS, SEAT_SHADES } from '../../../src/render/palette';
import { THEMES, themeFor } from '../../../src/render/themes';

const ids = (items: ReadonlyArray<{ id: string }>): string[] => items.map((i) => i.id);

/** Relative luminance (sRGB → linear, Rec. 709). */
function luminance(rgb: number): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((rgb >> 16) & 255) + 0.7152 * lin((rgb >> 8) & 255) + 0.0722 * lin(rgb & 255);
}

describe('cosmetic catalogue', () => {
  it('has the PLAN counts: 12 Puffs (8 free), 18 hats (12 free), 9 pop skins (6 free), 6 trails', () => {
    expect(PUFFS).toHaveLength(12);
    expect(PUFFS.filter((p) => tierOf(p) === 'free')).toHaveLength(8);
    expect(HATS).toHaveLength(18);
    expect(HATS.filter((h) => tierOf(h) === 'plus')).toHaveLength(6);
    expect(POP_SKINS).toHaveLength(9);
    expect(POP_SKINS.filter((p) => tierOf(p) === 'plus')).toHaveLength(3);
    expect(TRAILS).toHaveLength(6);
  });

  it('ids are unique and every Puff / hat has its own shape', () => {
    for (const list of [PUFFS, HATS, POP_SKINS, TRAILS]) {
      expect(new Set(ids(list)).size).toBe(list.length);
    }
    expect(new Set(PUFFS.map((p) => p.silhouette)).size).toBe(12);
    expect(new Set(HATS.map((h) => h.shape)).size).toBe(18);
  });

  it('free items unlock through milestones, never through a currency', () => {
    const kinds = new Set([...PUFFS, ...HATS, ...POP_SKINS, ...TRAILS].map((i) => i.unlock.kind));
    expect([...kinds].sort()).toEqual(['matches', 'plus', 'stars', 'start', 'streak', 'wins']);
    // Everything is reachable: the four starter Puffs are free from the start.
    expect(PUFFS.slice(0, 4).every((p) => p.unlock.kind === 'start')).toBe(true);
  });

  it('default look = starter Puff per seat, no hat, classic pop, no trail', () => {
    for (let s = 0; s < 4; s++) {
      const look = defaultAppearance(s);
      expect(puffIndex(look.puff)).toBe(s);
      expect(hatIndex(look.hat)).toBe(-1);
      expect(popSkinIndex(look.pop)).toBe(0);
      expect(trailIndex(look.trail)).toBe(-1);
    }
  });
});

describe('seats are distinguishable without colour', () => {
  it('four distinct colours, badge shapes and numbers', () => {
    expect(new Set(SEAT_COLORS).size).toBe(4);
    expect(new Set(SEAT_SHADES).size).toBe(4);
    expect(SEAT_BADGES).toEqual(['circle', 'triangle', 'square', 'star']);
    expect(new Set(SEAT_BADGES).size).toBe(4);
  });

  it('seat colours also differ in brightness (grayscale): every pair ≥ 0.1 apart', () => {
    const lum = SEAT_COLORS.map(luminance);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        expect(Math.abs((lum[a] as number) - (lum[b] as number))).toBeGreaterThanOrEqual(0.1);
      }
    }
  });
});

describe('arena themes', () => {
  it('12 arenas (6 free, 6 Plus) each with its own palette', () => {
    expect(ALL_ARENAS).toHaveLength(12);
    expect(FREE_ARENAS).toHaveLength(6);
    expect(PLUS_ARENAS).toHaveLength(6);
    expect(FREE_ARENAS.map((a) => a.id)).toEqual([
      'garden',
      'crossroads',
      'courtyard',
      'bastions',
      'rink',
      'teleport-garden',
    ]);
    expect(PLUS_ARENAS.map((a) => a.id)).toEqual([
      'factory',
      'tunnel',
      'trampoline',
      'rubble',
      'maze',
      'mixed',
    ]);
    const themes = ALL_ARENAS.map((a) => a.theme);
    expect(new Set(themes).size).toBe(12);
    for (const arena of ALL_ARENAS) expect(themeFor(arena.theme).id, arena.id).toBe(arena.theme);
    expect(THEMES).toHaveLength(12);
    expect(new Set(THEMES.map((t) => `${t.floorA}/${t.hedge}`)).size).toBe(12);
  });

  it('unknown themes fall back to the garden palette', () => {
    expect(themeFor('nope').id).toBe('garden');
  });
});
