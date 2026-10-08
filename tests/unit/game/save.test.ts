import { describe, expect, it } from 'vitest';
import { HATS, PUFFS, defaultAppearance } from '../../../src/content/cosmetics';
import { TROPHIES, trophyEarned, type TrophyContext } from '../../../src/content/trophies';
import { DailyStore } from '../../../src/game/dailyStore';
import { LooksStore, sanitizeLooks, wornLook } from '../../../src/game/looks';
import { ChallengeProgress, PROGRESS_KEY } from '../../../src/game/progress';
import {
  CORRUPT_KEY,
  LEGACY_KEYS,
  SAVE_KEY,
  SAVE_VERSION,
  SaveStore,
  migrate,
  parseSave,
} from '../../../src/game/save';
import type { MatchResult } from '../../../src/game/session';
import { SETTINGS_KEY, SettingsStore, defaultSettings } from '../../../src/game/settings';
import { EMPTY_STATS, StatsStore, matchDelta, sanitizeStats } from '../../../src/game/stats';
import { TipsStore } from '../../../src/game/tips';
import { isUnlocked, newlyUnlocked, type ProgressContext } from '../../../src/game/unlocks';
import { memoryStore } from '../../../src/platform/storage';

const ctx = (patch: Partial<ProgressContext> = {}): ProgressContext => ({
  stats: EMPTY_STATS,
  stars: 0,
  bestStreak: 0,
  hasPlus: false,
  ...patch,
});

describe('save document and migrations', () => {
  it('imports the loose version-0 keys once and removes them', () => {
    const backing = memoryStore({
      [SETTINGS_KEY]: JSON.stringify({ musicVolume: 0.3 }),
      [PROGRESS_KEY]: JSON.stringify({ 'w1-01': 2 }),
      'blastyard.tips.v1': JSON.stringify({ tutorialDone: true, shown: ['kick'] }),
      unrelated: 'stay',
    });
    const save = new SaveStore(backing);
    expect(save.storedVersion).toBe(SAVE_VERSION);
    for (const key of LEGACY_KEYS) expect(backing.get(key)).toBeNull();
    expect(backing.get('unrelated')).toBe('stay');
    // The parts read exactly what they had before.
    expect(new SettingsStore(save).get().musicVolume).toBe(0.3);
    expect(new ChallengeProgress(save).starsOf('w1-01')).toBe(2);
    expect(new TipsStore(save).tutorialDone).toBe(true);
    // And a restart reads the document, not the (gone) loose keys.
    const again = new SaveStore(backing);
    expect(new ChallengeProgress(again).starsOf('w1-01')).toBe(2);
    expect(parseSave(backing.get(SAVE_KEY)!)?.version).toBe(SAVE_VERSION);
  });

  it('writes every part into one document', () => {
    const backing = memoryStore();
    const save = new SaveStore(backing);
    new SettingsStore(save, defaultSettings()).update({ friendly: true });
    new DailyStore(save).beginAttempt(100);
    const doc = parseSave(backing.get(SAVE_KEY)!)!;
    expect(Object.keys(doc.entries).sort()).toEqual(['blastyard.daily.v1', SETTINGS_KEY].sort());
  });

  it('runs migration steps in order up to the target version', () => {
    const steps = {
      1: (d: { version: number; entries: Record<string, string> }) => ({
        version: 2,
        entries: { ...d.entries, added: 'by-1' },
      }),
      2: (d: { version: number; entries: Record<string, string> }) => ({
        version: 3,
        entries: { ...d.entries, renamed: d.entries['old'] ?? '' },
      }),
    };
    const out = migrate({ version: 1, entries: { old: 'x' } }, steps, 3);
    expect(out).toEqual({ version: 3, entries: { old: 'x', added: 'by-1', renamed: 'x' } });
    // Through the store: an old document is upgraded and written back.
    const backing = memoryStore({
      [SAVE_KEY]: JSON.stringify({ version: 1, entries: { old: 'y' } }),
    });
    const save = new SaveStore(backing, steps, 3);
    expect(save.get('renamed')).toBe('y');
    expect(parseSave(backing.get(SAVE_KEY)!)!.version).toBe(3);
  });

  it('a corrupt save falls back to defaults, is set aside and never crashes', () => {
    for (const bad of ['{not json', '[]', '{"version":"1"}', '{"version":1,"entries":3}']) {
      const backing = memoryStore({ [SAVE_KEY]: bad });
      const save = new SaveStore(backing);
      expect(backing.get(CORRUPT_KEY)).toBe(bad);
      expect(new SettingsStore(save, defaultSettings()).get()).toEqual(defaultSettings());
      expect(new ChallengeProgress(save).totalStars()).toBe(0);
      expect(new StatsStore(save).get()).toEqual(EMPTY_STATS);
      expect(new LooksStore(save).get(2)).toEqual(defaultAppearance(2));
    }
    // A part with garbage inside a valid document falls back on its own.
    const save = new SaveStore(
      memoryStore({
        [SAVE_KEY]: JSON.stringify({ version: 1, entries: { 'blastyard.stats.v1': '{"wins":-3' } }),
      }),
    );
    expect(new StatsStore(save).get()).toEqual(EMPTY_STATS);
  });

  it('a save from a newer app is read but not rewritten', () => {
    const raw = JSON.stringify({ version: 99, entries: { [PROGRESS_KEY]: '{"w1-02":3}' } });
    const backing = memoryStore({ [SAVE_KEY]: raw });
    const save = new SaveStore(backing);
    expect(new ChallengeProgress(save).starsOf('w1-02')).toBe(3);
    save.set('x', 'y');
    expect(backing.get(SAVE_KEY)).toBe(raw);
  });
});

function result(patch: Partial<MatchResult> = {}): MatchResult {
  const stats = [
    { knockouts: 2, selfKnockouts: 0, pops: 10, powerUps: 3 },
    { knockouts: 1, selfKnockouts: 1, pops: 7, powerUps: 1 },
    { knockouts: 0, selfKnockouts: 0, pops: 0, powerUps: 0 },
    { knockouts: 0, selfKnockouts: 0, pops: 0, powerUps: 0 },
  ];
  return {
    mode: 'party',
    winner: 0,
    wins: [3, 1, 0, 0],
    rounds: 4,
    plan: [
      { seat: 0, kind: 'human', orientation: 0 },
      { seat: 1, kind: 'bot', orientation: 0, botLevel: 2 },
      { seat: 2, kind: 'off', orientation: 0 },
      { seat: 3, kind: 'off', orientation: 0 },
    ],
    teams: null,
    stats,
    ...patch,
  };
}

describe('lifetime stats', () => {
  it('counts human seats only, wins, clean wins and the favourite arena', () => {
    expect(matchDelta(result())).toMatchObject({
      matches: 1,
      wins: 1,
      cleanWins: 1,
      knockouts: 2,
      pops: 10,
    });
    expect(matchDelta(result({ winner: 1 }))).toMatchObject({ wins: 0, cleanWins: 0 });
    const allBots = result({
      plan: result().plan.map((p) => ({ ...p, kind: p.kind === 'human' ? 'bot' : p.kind })),
    });
    expect(matchDelta(allBots)).toBeNull();
    const store = memoryStore();
    const stats = new StatsStore(store);
    stats.recordMatch(result(), 'garden');
    stats.recordMatch(result({ winner: 1 }), 'rink');
    stats.recordMatch(result(), 'rink');
    stats.recordChallengeWin();
    stats.recordDailyWin();
    const again = new StatsStore(store);
    expect(again.get()).toMatchObject({ matches: 3, wins: 2, challengesWon: 1, dailyWins: 1 });
    expect(again.favouriteArena()).toBe('rink');
    expect(sanitizeStats({ matches: 2.5, arenas: { a: -1, b: 2 } })).toMatchObject({
      matches: 0,
      arenas: { b: 2 },
    });
  });

  it('team wins count for the human team', () => {
    const teamResult = result({
      teams: [0, 1, 0, 1],
      winner: 0,
      plan: result().plan.map((p) => (p.seat === 2 ? { ...p, kind: 'bot' } : p)),
    });
    expect(matchDelta(teamResult)?.wins).toBe(1);
  });
});

describe('milestone unlocks and trophies', () => {
  const sprout = PUFFS.find((p) => p.id === 'sprout')!; // 5 matches
  const cat = PUFFS.find((p) => p.id === 'cat')!; // Plus
  const crown = HATS.find((h) => h.unlock.kind === 'streak')!;

  it('opens free items by milestones and Plus items by Blastyard+', () => {
    expect(isUnlocked(PUFFS[0]!, ctx())).toBe(true);
    expect(isUnlocked(sprout, ctx())).toBe(false);
    expect(isUnlocked(sprout, ctx({ stats: { ...EMPTY_STATS, matches: 5 } }))).toBe(true);
    expect(isUnlocked(cat, ctx({ stats: { ...EMPTY_STATS, matches: 999 } }))).toBe(false);
    expect(isUnlocked(cat, ctx({ hasPlus: true }))).toBe(true);
    expect(isUnlocked(crown, ctx({ bestStreak: 10 }))).toBe(true);
    const before = ctx({ stats: { ...EMPTY_STATS, matches: 4 } });
    const after = ctx({ stats: { ...EMPTY_STATS, matches: 5 } });
    expect(newlyUnlocked(PUFFS, before, after).map((p) => p.id)).toEqual(['sprout']);
  });

  it('wears a locked choice as the seat default, keeps the choice', () => {
    const look = { ...defaultAppearance(0), puff: 'cat', hat: 'cap' };
    expect(wornLook(look, 0, ctx()).puff).toBe(defaultAppearance(0).puff);
    expect(wornLook(look, 0, ctx()).hat).toBe('cap');
    expect(wornLook(look, 0, ctx({ hasPlus: true })).puff).toBe('cat');
    const store = memoryStore();
    new LooksStore(store).set(1, { puff: 'cat', hat: 'nope' });
    expect(new LooksStore(store).get(1)).toMatchObject({ puff: 'cat', hat: null });
    expect(sanitizeLooks('x')).toHaveLength(4);
  });

  it('has 20 trophies, earned from progress', () => {
    expect(TROPHIES).toHaveLength(20);
    expect(new Set(TROPHIES.map((d) => d.id)).size).toBe(20);
    const empty: TrophyContext = { ...ctx(), starsOf: () => 0, tutorialDone: false };
    expect(TROPHIES.filter((d) => trophyEarned(d, empty))).toEqual([]);
    const busy: TrophyContext = {
      ...ctx({
        stats: { ...EMPTY_STATS, matches: 12, wins: 10, cleanWins: 1, knockouts: 10 },
        stars: 30,
        bestStreak: 3,
      }),
      starsOf: (id) => (id.startsWith('w1-') ? 1 : 0),
      tutorialDone: true,
    };
    const earned = TROPHIES.filter((d) => trophyEarned(d, busy)).map((d) => d.id);
    expect(earned).toEqual(
      expect.arrayContaining([
        'firstMatch',
        'firstWin',
        'matches10',
        'wins10',
        'ko10',
        'cleanWin',
        'tutorial',
        'firstStar',
        'stars30',
        'world1',
        'gauntlet',
        'streak3',
      ]),
    );
    expect(earned).not.toContain('matches50');
  });
});
