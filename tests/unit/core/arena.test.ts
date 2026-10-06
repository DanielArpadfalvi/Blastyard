import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  GRID_W,
  LayoutCell,
  Pickup,
  Tile,
  createState,
  loadArena,
  parseArena,
  playerCell,
  spawnSafeL,
  tileCenter,
  validateArena,
  type ArenaDef,
} from '../../../src/core';
import { ARENA_GARDEN, CLASSIC_ARENAS } from '../../../src/content/arenas/classic';

const ALL = [true, true, true, true];

function withRows(rows: string[], extra: Partial<ArenaDef> = {}): ArenaDef {
  return { id: 'test', theme: 'test', size: 13, rows, ...extra };
}

function editRow(def: ArenaDef, y: number, x: number, ch: string): string[] {
  return def.rows.map((row, i) => (i === y ? row.slice(0, x) + ch + row.slice(x + 1) : row));
}

function codes(def: ArenaDef): string[] {
  return validateArena(def).errors.map((e) => e.code);
}

describe('classic arenas', () => {
  it('has four layouts that load and validate', () => {
    expect(CLASSIC_ARENAS).toHaveLength(4);
    expect(new Set(CLASSIC_ARENAS.map((a) => a.id)).size).toBe(4);
    for (const arena of CLASSIC_ARENAS) {
      const result = validateArena(arena);
      expect(result.errors, arena.id).toEqual([]);
      expect(result.ok).toBe(true);
      expect(() => createState({ seed: 1, arena, seats: ALL })).not.toThrow();
    }
  });

  it('garden has 25 pillars on the even interior positions', () => {
    const parsed = loadArena(ARENA_GARDEN);
    let pillars = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      if (parsed.cells[i] !== LayoutCell.PILLAR) continue;
      pillars++;
      const x = i % GRID_W;
      const y = (i - x) / GRID_W;
      expect(x % 2).toBe(0);
      expect(y % 2).toBe(0);
    }
    expect(pillars).toBe(25);
  });
});

describe('arena validator', () => {
  it('rejects a spawn without a safe L (crate candidate next to the spawn)', () => {
    let rows = editRow(ARENA_GARDEN, 1, 2, '?');
    rows = editRow({ ...ARENA_GARDEN, rows }, 2, 1, '?');
    expect(codes(withRows(rows))).toContain('safe-l');
  });

  it('rejects a disconnected arena', () => {
    // Wall off the bottom-right corner pocket (spawn 4 and its L) from the rest.
    let rows = editRow(ARENA_GARDEN, 11, 9, '#');
    rows = editRow({ ...ARENA_GARDEN, rows }, 9, 11, '#');
    const result = codes(withRows(rows));
    expect(result).toContain('connectivity');
    expect(result).not.toContain('safe-l');
  });

  it('rejects an unfair arena (one corner gets an extra pillar)', () => {
    const rows = editRow(ARENA_GARDEN, 3, 1, 'o');
    const result = codes(withRows(rows));
    expect(result.length).toBeGreaterThan(0);
    expect(new Set(result)).toEqual(new Set(['fairness']));
  });

  it('rejects shape, character, border and spawn problems', () => {
    expect(codes(withRows(ARENA_GARDEN.rows.slice(0, 12)))).toEqual(['size']);
    expect(codes(withRows([...ARENA_GARDEN.rows], { size: 15 }))).toEqual(['size']);
    expect(codes(withRows(editRow(ARENA_GARDEN, 5, 5, 'X')))).toContain('char');
    expect(codes(withRows(editRow(ARENA_GARDEN, 0, 6, '.')))).toContain('border');
    expect(codes(withRows(editRow(ARENA_GARDEN, 11, 11, '.')))).toContain('spawn');
    expect(codes(withRows(editRow(ARENA_GARDEN, 5, 5, '1')))).toContain('spawn');
    expect(codes(withRows([...ARENA_GARDEN.rows], { crateDensity: 70.5 }))).toContain('density');
    expect(codes(withRows([...ARENA_GARDEN.rows], { powerupWeights: [1, 2] }))).toContain(
      'weights',
    );
    expect(() => loadArena(withRows(editRow(ARENA_GARDEN, 3, 1, 'o')))).toThrow(/invalid/);
  });

  it('finds the safe L of every classic spawn', () => {
    const parsed = parseArena(ARENA_GARDEN).parsed;
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    for (const spawn of parsed.spawns) expect(spawnSafeL(parsed, spawn)).toHaveLength(3);
  });
});

describe('seeded arena generation', () => {
  it('same seed ⇒ identical crate and pickup layout', () => {
    for (const arena of CLASSIC_ARENAS) {
      const a = createState({ seed: 2024, arena, seats: ALL });
      const b = createState({ seed: 2024, arena, seats: ALL });
      expect(a.tiles).toEqual(b.tiles);
      expect(a.hidden).toEqual(b.hidden);
    }
  });

  it('different seeds ⇒ different layouts', () => {
    const a = createState({ seed: 1, arena: ARENA_GARDEN, seats: ALL });
    const b = createState({ seed: 2, arena: ARENA_GARDEN, seats: ALL });
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it('layout does not depend on the seat setup', () => {
    const four = createState({ seed: 9, arena: ARENA_GARDEN, seats: ALL });
    const three = createState({ seed: 9, arena: ARENA_GARDEN, seats: [true, true, true, false] });
    const two = createState({ seed: 9, arena: ARENA_GARDEN, seats: [true, false, false, true] });
    expect(three.tiles).toEqual(four.tiles);
    expect(two.hidden).toEqual(four.hidden);
  });

  it('fills exactly 70% of the candidates and keeps spawn L zones clear', () => {
    const parsed = loadArena(ARENA_GARDEN);
    let candidates = 0;
    for (let i = 0; i < CELL_COUNT; i++) if (parsed.cells[i] === LayoutCell.CANDIDATE) candidates++;
    for (let seed = 0; seed < 20; seed++) {
      const state = createState({ seed, arena: ARENA_GARDEN, seats: ALL });
      let crates = 0;
      for (let i = 0; i < CELL_COUNT; i++) {
        if (state.tiles[i] === Tile.CRATE) {
          crates++;
          expect(parsed.cells[i]).toBe(LayoutCell.CANDIDATE);
        }
      }
      expect(crates).toBe(Math.floor((candidates * 70 + 50) / 100));
      for (const spawn of parsed.spawns) {
        for (const c of spawnSafeL(parsed, spawn) ?? []) expect(state.tiles[c]).toBe(Tile.FLOOR);
      }
    }
  });

  it('hides power-ups only under crates, ~30% of them, with valid kinds', () => {
    let crates = 0;
    let hidden = 0;
    for (let seed = 0; seed < 200; seed++) {
      const state = createState({ seed, arena: ARENA_GARDEN, seats: ALL });
      for (let i = 0; i < CELL_COUNT; i++) {
        const h = state.hidden[i] as number;
        if (state.tiles[i] === Tile.CRATE) crates++;
        if (h === Pickup.NONE) continue;
        hidden++;
        expect(state.tiles[i]).toBe(Tile.CRATE);
        expect(h).toBeGreaterThanOrEqual(Pickup.EXTRA_POP);
        expect(h).toBeLessThanOrEqual(Pickup.JINX);
      }
    }
    expect(Math.abs(hidden / crates - 0.3)).toBeLessThan(0.02);
  });

  it('honours powerupChance and arena weights', () => {
    const none = createState({
      seed: 1,
      arena: ARENA_GARDEN,
      seats: ALL,
      rules: { powerupChance: 0 },
    });
    expect(none.hidden.every((h) => h === 0)).toBe(true);
    const onlyKick: ArenaDef = { ...ARENA_GARDEN, powerupWeights: [0, 0, 0, 1, 0, 0, 0, 0, 0] };
    const kick = createState({
      seed: 1,
      arena: onlyKick,
      seats: ALL,
      rules: { powerupChance: 100 },
    });
    for (let i = 0; i < CELL_COUNT; i++) {
      if (kick.tiles[i] === Tile.CRATE) expect(kick.hidden[i]).toBe(Pickup.KICK);
    }
  });
});

describe('spawn assignment', () => {
  const parsed = loadArena(ARENA_GARDEN);
  const at = (spawnNo: number) => parsed.spawns[spawnNo - 1] as number;

  it('4 players take spawns 1–4 in seat order at tile centres', () => {
    const state = createState({ seed: 1, arena: ARENA_GARDEN, seats: ALL });
    for (let s = 0; s < 4; s++) {
      expect(playerCell(state, s)).toBe(at(s + 1));
      expect((state.px[s] as number) % 256).toBe(128);
      expect(state.py[s]).toBe(tileCenter(Math.floor(at(s + 1) / GRID_W)));
    }
  });

  it('2 players take diagonal corners', () => {
    const state = createState({ seed: 1, arena: ARENA_GARDEN, seats: [false, true, false, true] });
    expect(playerCell(state, 1)).toBe(at(1));
    expect(playerCell(state, 3)).toBe(at(4));
    expect(state.alive[0]).toBe(0);
  });

  it('3 players take three seeded corners', () => {
    const used = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const state = createState({ seed, arena: ARENA_GARDEN, seats: [true, true, true, false] });
      const cells = [0, 1, 2].map((s) => playerCell(state, s));
      expect(new Set(cells).size).toBe(3);
      used.add(cells.join(','));
    }
    expect(used.size).toBeGreaterThan(1);
  });

  it('rejects invalid setups', () => {
    expect(() => createState({ seed: 1, arena: ARENA_GARDEN, seats: [false] })).toThrow();
    expect(() => createState({ seed: 0.5, arena: ARENA_GARDEN, seats: ALL })).toThrow();
  });
});
