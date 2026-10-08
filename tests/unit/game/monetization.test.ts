import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN, FREE_ARENAS, PLUS_ARENAS, isPlusArena } from '../../../src/content/arenas';
import { LEVELS, worldNeedsPlus } from '../../../src/content/challenges';
import { HATS, POP_SKINS, PUFFS, TRAILS, tierOf } from '../../../src/content/cosmetics';
import {
  BotLevel,
  CLASSIC_RULES,
  DEFAULT_POWERUP_WEIGHTS,
  PICKUP_KIND_COUNT,
  RULE_PRESETS,
  createState,
  type PresetId,
} from '../../../src/core';
import {
  DEFAULT_CUSTOM,
  customArena,
  customToRules,
  noPowerups,
  sanitizeCustom,
  scaleWeights,
  type CustomRules,
} from '../../../src/game/customRules';
import { dailyCandidate } from '../../../src/game/daily';
import {
  DEFAULT_PARTY,
  isPlayable,
  partyArena,
  partyMatchSetup,
  partyRules,
  resolveParty,
  seatChoices,
  setCustom,
  setPreset,
  type PartyConfig,
  type PartyLayout,
  type PartySeat,
} from '../../../src/game/party';
import { sanitizeStored } from '../../../src/game/partyStore';
import { ChallengeProgress } from '../../../src/game/progress';
import { unlockProgress, type ProgressContext } from '../../../src/game/unlocks';
import { memoryStore } from '../../../src/platform/storage';

const human: PartySeat = { kind: 'human', level: BotLevel.NORMAL };

const CUSTOM: CustomRules = {
  ...DEFAULT_CUSTOM,
  roundSeconds: 60,
  startBombs: 3,
  startRange: 4,
  startSpeed: 2,
  powerupChance: 45,
  powerups: [3, 3, 0, 0, 1, 2, 2, 2, 0],
  suddenDeath: 'none',
  ghosts: false,
};

describe('custom rules (Blastyard+)', () => {
  it('map onto the core rules', () => {
    const rules = customToRules(CUSTOM, 5);
    expect(rules).toMatchObject({
      roundSeconds: 60,
      startBombs: 3,
      startRange: 4,
      startSpeedLevel: 2,
      powerupChance: 45,
      suddenDeath: 'none',
      ghosts: false,
      winsToMatch: 5,
      friendlyFire: CLASSIC_RULES.friendlyFire,
    });
    // Often = 2×, rare = ½ (at least 1), off = 0.
    expect(rules.powerupWeights).toEqual([52, 52, 0, 0, 3, 5, 5, 3, 0]);
    // A match starts with them.
    const state = createState({
      seed: 1,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      rules,
    });
    expect([...state.weights]).toEqual([52, 52, 0, 0, 3, 5, 5, 3, 0]);
  });

  it('defaults equal the Classic preset', () => {
    expect(customToRules(DEFAULT_CUSTOM, 3)).toEqual({ ...CLASSIC_RULES, winsToMatch: 3 });
  });

  it('all power-ups off: crates hide nothing, weights stay valid', () => {
    const off: CustomRules = { ...DEFAULT_CUSTOM, powerups: Array(PICKUP_KIND_COUNT).fill(0) };
    expect(noPowerups(off)).toBe(true);
    const rules = customToRules(off, 3);
    expect(rules.powerupChance).toBe(0);
    expect(rules.powerupWeights).toEqual(DEFAULT_POWERUP_WEIGHTS);
    expect(scaleWeights(DEFAULT_POWERUP_WEIGHTS, off.powerups)).toBeNull();
  });

  it("apply to arenas with their own weights (they would override the rules')", () => {
    const own = PLUS_ARENAS.find((a) => a.powerupWeights) ?? {
      ...ARENA_GARDEN,
      powerupWeights: [10, 10, 10, 10, 10, 10, 10, 10, 10],
    };
    const changed = customArena(own, CUSTOM);
    expect(changed.id).toBe(own.id);
    expect(changed.powerupWeights?.[2]).toBe(0);
    expect(customArena(ARENA_GARDEN, CUSTOM)).toBe(ARENA_GARDEN);
  });

  it('play only with Blastyard+; otherwise the setup plays Classic', () => {
    const config = setCustom(DEFAULT_PARTY, CUSTOM);
    expect(config.preset).toBe('custom');
    expect(partyRules(config, true).startBombs).toBe(3);
    expect(partyRules(config, false)).toEqual({ ...CLASSIC_RULES, winsToMatch: 3 });
    expect(resolveParty(config).rules.startBombs).toBe(1);
    expect(resolveParty(config, true).rules.startBombs).toBe(3);
    const withOwn = { ...ARENA_GARDEN, powerupWeights: [5, 5, 5, 5, 5, 5, 5, 5, 5] };
    expect(partyArena(withOwn, config, false)).toBe(withOwn);
    expect(partyArena(withOwn, config, true).powerupWeights?.[3]).toBe(0);
  });

  it('are stored and validated with the party', () => {
    const stored = sanitizeStored({ config: setCustom(DEFAULT_PARTY, CUSTOM) });
    expect(stored.config.preset).toBe('custom');
    expect(stored.config.custom).toEqual(CUSTOM);
    expect(sanitizeCustom({ roundSeconds: 7, startBombs: 99, powerups: [9, 'x'] })).toEqual(
      DEFAULT_CUSTOM,
    );
    expect(sanitizeStored({ config: { preset: 'custom' } }).config.custom).toEqual(DEFAULT_CUSTOM);
  });
});

describe('the party core is never gated (PLAN §2)', () => {
  const layouts: readonly PartyLayout[] = ['faceoff', 'corners'];

  it('every bot level and human seats are offered without Blastyard+', () => {
    for (const layout of layouts) {
      for (let seat = 0; seat < 4; seat++) {
        const levels = seatChoices(layout, seat)
          .filter((c) => c.kind === 'bot')
          .map((c) => c.level);
        expect(levels).toEqual([BotLevel.EASY, BotLevel.NORMAL, BotLevel.HARD, BotLevel.EXPERT]);
      }
    }
  });

  it('1–4 players play without Blastyard+, with bots on the other seats', () => {
    for (let humans = 1; humans <= 4; humans++) {
      const seats: PartySeat[] = [0, 1, 2, 3].map((i) =>
        i < humans ? human : { kind: 'bot', level: BotLevel.EXPERT },
      );
      const config: PartyConfig = { ...DEFAULT_PARTY, layout: 'corners', seats };
      expect(isPlayable(config)).toBe(true);
      const plan = resolveParty(config, false);
      expect(plan.seats.filter((s) => s.kind === 'human')).toHaveLength(humans);
      const setup = partyMatchSetup(plan, 1, ARENA_GARDEN);
      expect((setup.bots ?? []).filter((b) => b === BotLevel.EXPERT)).toHaveLength(4 - humans);
    }
  });

  it('every preset and 2v2 play the same with and without Blastyard+', () => {
    for (const preset of Object.keys(RULE_PRESETS) as PresetId[]) {
      const config = { ...setPreset(DEFAULT_PARTY, preset), teams: true };
      expect(partyRules(config, false)).toEqual(partyRules(config, true));
      expect(resolveParty(config, false)).toEqual(resolveParty(config, true));
    }
  });

  it('all nine power-ups (Jinx included) drop in every free preset', () => {
    for (const rules of Object.values(RULE_PRESETS)) {
      expect(rules.powerupWeights).toHaveLength(PICKUP_KIND_COUNT);
      expect(rules.powerupWeights.every((w) => w > 0)).toBe(true);
      expect(rules.powerupChance).toBeGreaterThan(0);
    }
  });

  it('six arenas, world 1 and the daily challenge are free', () => {
    expect(FREE_ARENAS).toHaveLength(6);
    expect(FREE_ARENAS.some(isPlusArena)).toBe(false);
    const progress = new ChallengeProgress(memoryStore());
    const world1 = LEVELS.filter((l) => l.world === 1);
    expect(world1).toHaveLength(12);
    expect(worldNeedsPlus(1)).toBe(false);
    for (const level of world1) expect(progress.lockOf(level, false)).not.toBe('locked-plus');
    for (let day = 20000; day < 20060; day++) {
      expect(isPlusArena(dailyCandidate(day).baseArena)).toBe(false);
    }
  });

  it('paid cosmetics are extra: the free catalogue is complete on its own', () => {
    const free = (list: readonly { unlock: { kind: string } }[]) =>
      list.filter((i) => tierOf(i as never) === 'free').length;
    expect([free(PUFFS), free(HATS), free(POP_SKINS), free(TRAILS)]).toEqual([8, 12, 6, 5]);
  });

  it('the Supporter pack unlocks only its own two items', () => {
    const ctx = (hasSupporter: boolean): ProgressContext => ({
      stats: {} as never,
      stars: 0,
      bestStreak: 0,
      hasPlus: false,
      hasSupporter,
    });
    expect(unlockProgress({ kind: 'supporter' }, ctx(false)).have).toBe(0);
    expect(unlockProgress({ kind: 'supporter' }, ctx(true)).have).toBe(1);
    expect(unlockProgress({ kind: 'plus' }, ctx(true)).have).toBe(0);
  });
});
