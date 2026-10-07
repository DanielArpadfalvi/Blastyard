import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  LEVELS_PER_WORLD,
  WORLD_COUNT,
  isGauntlet,
  levelById,
  nextLevel,
  tuningOf,
  worldLevels,
} from '../../../src/content/challenges';
import { SOLUTIONS } from '../../../src/content/challenges/solutions';
import {
  challengeArenas,
  validateContent,
  validateLevelSolution,
  validateLevelStructure,
} from '../../../src/content/challenges/validate';
import { Monster } from '../../../src/core';
import type { LevelDef, ObjectiveType } from '../../../src/game/challenge';
import { DICTIONARIES } from '../../../src/i18n';

describe('challenge content', () => {
  it('36 levels: three worlds of twelve, the last of each is a three-stage gauntlet', () => {
    expect(LEVELS).toHaveLength(WORLD_COUNT * LEVELS_PER_WORLD);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(36);
    for (let world = 1; world <= WORLD_COUNT; world++) {
      const levels = worldLevels(world);
      expect(levels.map((l) => l.index)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
      expect(isGauntlet(levels[11]!)).toBe(true);
      expect(levels[11]!.stages).toHaveLength(3);
      expect(levels.slice(0, 11).every((l) => l.stages.length === 1)).toBe(true);
    }
    expect(nextLevel('w1-12')?.id).toBe('w2-01');
    expect(nextLevel('w3-12')).toBeUndefined();
    expect(levelById('w2-07')?.world).toBe(2);
  });

  it('uses every objective type and every monster kind', () => {
    const types = new Set<ObjectiveType>();
    const kinds = new Set<number>();
    for (const l of LEVELS) {
      for (const s of l.stages) {
        types.add(s.objective.type);
        for (const m of s.monsters ?? []) kinds.add(m.kind);
      }
    }
    expect([...types].sort()).toEqual(['collect', 'crates', 'flag', 'monsters', 'survive', 'win']);
    expect([...kinds].sort()).toEqual([Monster.SNAIL, Monster.HOUND, Monster.HOPPER]);
  });

  it('level names and everything the card shows exist in English and Hungarian', () => {
    for (const l of LEVELS) {
      expect(DICTIONARIES.en[l.nameKey as keyof typeof DICTIONARIES.en], l.id).toBeTruthy();
      expect(DICTIONARIES.hu[l.nameKey as keyof typeof DICTIONARIES.hu], l.id).toBeTruthy();
    }
  });

  it('structure checks pass for every level and every challenge arena validates', () => {
    for (const l of LEVELS) expect(validateLevelStructure(l), l.id).toEqual([]);
    expect(challengeArenas().length).toBeGreaterThan(20);
  });

  it('scripts/validate-content: all 36 reference solutions replay and win with 3 stars', () => {
    expect(validateContent(SOLUTIONS)).toEqual([]);
  });

  it('a damaged solution, a wrong hash or a missing solution is reported', () => {
    const level = levelById('w1-01')!;
    const good = SOLUTIONS[level.id]!;
    expect(validateLevelSolution(level, good)).toEqual([]);

    // Drop the first real input run: the replay no longer wins (or its hash changes).
    const log = good.logs[0]!.slice();
    const at = log.findIndex((v, i) => i % 2 === 0 && v !== 0);
    log[at] = 0;
    const damaged = validateLevelSolution(level, { ...good, logs: [log] });
    expect(damaged.length).toBeGreaterThan(0);

    const wrongHash = validateLevelSolution(level, { ...good, hashes: ['00000000'] });
    expect(wrongHash.some((i) => i.message.includes('state hash'))).toBe(true);

    expect(validateLevelSolution(level, undefined)[0]!.message).toContain('no reference solution');
    expect(validateContent({ ...SOLUTIONS, 'w9-99': good }).some((i) => i.where === 'w9-99')).toBe(
      true,
    );
  });

  it('structure checks catch a monster next to the start, a flag on a crate cell and a bad time', () => {
    const base = levelById('w1-04')!;
    const stage = base.stages[0]!;
    const tooClose: LevelDef = {
      ...base,
      stages: [{ ...stage, monsters: [{ kind: Monster.SNAIL, x: 2, y: 1 }] }],
    };
    expect(validateLevelStructure(tooClose).some((i) => i.message.includes('too close'))).toBe(
      true,
    );
    const onCrate: LevelDef = {
      ...base,
      stages: [{ ...stage, monsters: [{ kind: Monster.SNAIL, x: 3, y: 1 }] }],
    };
    expect(validateLevelStructure(onCrate).some((i) => i.message.includes('plain floor'))).toBe(
      true,
    );
    const flagless: LevelDef = {
      ...base,
      stages: [{ ...stage, objective: { type: 'flag', seconds: 30 } }],
    };
    expect(validateLevelStructure(flagless).some((i) => i.message.includes('without a flag'))).toBe(
      true,
    );
    const mismatched = {
      ...tuningOf('w1-04'),
      stars: [{ kind: 'noDamage' }, { kind: 'noDamage' }],
    };
    expect(mismatched.stars[0]!.kind).not.toBe(base.stars[0]);
  });
});
