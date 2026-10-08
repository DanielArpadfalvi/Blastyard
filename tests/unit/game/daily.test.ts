import { describe, expect, it } from 'vitest';
import { validateLevelStructure } from '../../../src/content/challenges/validate';
import { rleEncode } from '../../../src/core';
import { replayLevel } from '../../../src/game/challenge';
import {
  DAILY_MODIFIERS,
  dailyCandidate,
  dailyFromPick,
  dateOfDay,
  dayKey,
  dayNumber,
  isDailyLevel,
  prepareDaily,
  prepareDailyAsync,
} from '../../../src/game/daily';
import { DAILY_KEY, DailyStore, sanitizeDaily } from '../../../src/game/dailyStore';
import { botPlay } from '../../../src/game/solver';
import { localDate, parseDate } from '../../../src/platform/clock';
import { memoryStore } from '../../../src/platform/storage';

const OCT_8_2026 = dayNumber({ year: 2026, month: 10, day: 8 });

describe('calendar days', () => {
  it('counts days since 1970-01-01 and converts back', () => {
    expect(dayNumber({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(dayNumber({ year: 2000, month: 3, day: 1 })).toBe(11017);
    expect(OCT_8_2026).toBe(Date.UTC(2026, 9, 8) / 86_400_000);
    for (let d = OCT_8_2026 - 800; d < OCT_8_2026 + 800; d += 7) {
      expect(dayNumber(dateOfDay(d))).toBe(d);
    }
    expect(dayKey(OCT_8_2026)).toBe('2026-10-08');
    expect(dateOfDay(dayNumber({ year: 2028, month: 2, day: 29 }))).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it('takes the date from the platform clock and parses overrides', () => {
    const noon = new Date(2026, 9, 8, 12, 0, 0).getTime();
    expect(localDate({ now: () => noon })).toEqual({ year: 2026, month: 10, day: 8 });
    expect(parseDate('2026-10-08')).toEqual({ year: 2026, month: 10, day: 8 });
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('8 Oct')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('daily challenge generation', () => {
  it('gives the same challenge for the same date', () => {
    const a = dailyCandidate(OCT_8_2026);
    const b = dailyCandidate(dayNumber({ year: 2026, month: 10, day: 8 }));
    expect(b).toEqual(a);
    expect(a.level.id).toBe('daily-2026-10-08');
    expect(isDailyLevel(a.level)).toBe(true);
    const p1 = prepareDaily(OCT_8_2026);
    const p2 = prepareDaily(OCT_8_2026);
    expect(p2.challenge.tuning).toEqual(p1.challenge.tuning);
    expect(p2.pick).toEqual(p1.pick);
  });

  it('varies arena, modifier and objective over the days and stays structurally valid', () => {
    const objectives = new Set<string>();
    const modifiers = new Set<string>();
    const arenas = new Set<string>();
    const combos = new Set<string>();
    for (let d = OCT_8_2026; d < OCT_8_2026 + 120; d++) {
      const def = dailyCandidate(d);
      const stage = def.level.stages[0]!;
      objectives.add(stage.objective.type);
      modifiers.add(def.modifier);
      arenas.add(def.baseArena.id);
      combos.add(`${stage.arena.id}|${def.modifier}|${stage.objective.type}`);
      expect(validateLevelStructure(def.level)).toEqual([]);
      if (stage.objective.type === 'collect' || stage.objective.type === 'survive') {
        expect(def.modifier).not.toBe('lean');
      }
    }
    expect(objectives.size).toBe(6);
    expect(modifiers.size).toBe(DAILY_MODIFIERS.length);
    expect(arenas.size).toBe(6);
    expect(combos.size).toBeGreaterThan(90);
  });

  it('proves every prepared day winnable: the bot run replays as a plain human seat', () => {
    for (let d = OCT_8_2026; d < OCT_8_2026 + 4; d++) {
      const { challenge, pick } = prepareDaily(d);
      const seed = challenge.tuning.seeds[0]!;
      const log = rleEncode(botPlay(challenge.level, 0, seed).bytes);
      const outcome = replayLevel(challenge.level, challenge.tuning.seeds, [log]);
      expect(outcome.status).toBe('won');
      expect(dailyFromPick(d, pick)?.tuning).toEqual(challenge.tuning);
    }
  });

  it('prepares asynchronously with the same result, reusing a remembered pick', async () => {
    const sync = prepareDaily(OCT_8_2026 + 1);
    let pauses = 0;
    const pause = (): Promise<void> => {
      pauses++;
      return Promise.resolve();
    };
    const fresh = await prepareDailyAsync(OCT_8_2026 + 1, null, pause);
    expect(fresh.challenge.tuning).toEqual(sync.challenge.tuning);
    expect(pauses).toBeGreaterThan(0);
    pauses = 0;
    const known = await prepareDailyAsync(OCT_8_2026 + 1, fresh.pick, pause);
    expect(known.challenge.tuning).toEqual(sync.challenge.tuning);
    expect(pauses).toBe(0);
  });
});

describe('daily progress', () => {
  const won = (stars: number, ticks: number) => ({ won: true, stars, ticks });
  const lost = { won: false, stars: 0, ticks: 900 };

  it('makes the first attempt of a day the official one', () => {
    const daily = new DailyStore(memoryStore());
    const day = OCT_8_2026;
    expect(daily.view(day).official).toBe('none');
    expect(daily.beginAttempt(day)).toBe(true);
    expect(daily.view(day).official).toBe('started');
    expect(daily.beginAttempt(day)).toBe(false);
    daily.finish(day, false, won(3, 1200));
    // The unfinished official attempt stays used up; practice still sets the best.
    expect(daily.view(day).official).toBe('started');
    expect(daily.view(day).best).toEqual(won(3, 1200));
    expect(daily.view(day).attempts).toBe(2);
    // The next day starts fresh.
    expect(daily.beginAttempt(day + 1)).toBe(true);
    daily.finish(day + 1, true, lost);
    expect(daily.view(day + 1).official).toEqual(lost);
    expect(daily.view(day + 1).best).toEqual(lost);
  });

  it('keeps the best result: more stars, then less time', () => {
    const daily = new DailyStore(memoryStore());
    const day = OCT_8_2026;
    daily.finish(day, daily.beginAttempt(day), won(2, 2000));
    daily.finish(day, daily.beginAttempt(day), won(1, 900));
    expect(daily.view(day).best).toEqual(won(2, 2000));
    daily.finish(day, daily.beginAttempt(day), won(2, 1500));
    daily.finish(day, daily.beginAttempt(day), lost);
    expect(daily.view(day).best).toEqual(won(2, 1500));
    expect(daily.view(day).official).toEqual(won(2, 2000));
  });

  it('counts a streak of won days that survives a restart and resets after a missed day', () => {
    const store = memoryStore();
    let daily = new DailyStore(store);
    const d0 = OCT_8_2026;
    daily.finish(d0, daily.beginAttempt(d0), won(1, 3000));
    daily.finish(d0, daily.beginAttempt(d0), won(2, 2000));
    expect(daily.view(d0).streak).toBe(1);
    daily.finish(d0 + 1, daily.beginAttempt(d0 + 1), lost);
    expect(daily.view(d0 + 1).streak).toBe(1);
    daily.finish(d0 + 1, daily.beginAttempt(d0 + 1), won(1, 3000));
    expect(daily.view(d0 + 1)).toMatchObject({ streak: 2, wonToday: true });

    // App restart: a new store instance over the same storage.
    daily = new DailyStore(store);
    expect(daily.view(d0 + 1).streak).toBe(2);
    // Still alive the next day until it is played…
    expect(daily.view(d0 + 2)).toMatchObject({ streak: 2, wonToday: false });
    daily.finish(d0 + 2, daily.beginAttempt(d0 + 2), won(1, 3000));
    expect(daily.view(d0 + 2).streak).toBe(3);
    // …but a missed day breaks it.
    expect(daily.view(d0 + 4).streak).toBe(0);
    daily.finish(d0 + 4, daily.beginAttempt(d0 + 4), won(1, 3000));
    expect(daily.view(d0 + 4)).toMatchObject({ streak: 1, bestStreak: 3 });
  });

  it('remembers where the day was found, per simulation version', () => {
    const daily = new DailyStore(memoryStore());
    expect(daily.pickFor(OCT_8_2026)).toBeNull();
    daily.rememberPick(OCT_8_2026, { roll: 0, attempt: 2 });
    expect(daily.pickFor(OCT_8_2026)).toEqual({ roll: 0, attempt: 2 });
    expect(daily.pickFor(OCT_8_2026 + 1)).toBeNull();
  });

  it('falls back to defaults on corrupt data', () => {
    const daily = new DailyStore(memoryStore({ [DAILY_KEY]: '{not json' }));
    expect(daily.view(OCT_8_2026)).toMatchObject({ streak: 0, official: 'none', best: null });
    const odd = sanitizeDaily({
      day: 'x',
      official: { won: true, stars: 0, ticks: 5 },
      best: { won: true, stars: 9, ticks: -1 },
      streak: 4,
      bestStreak: 2,
      lastWonDay: OCT_8_2026,
      pick: { day: 1, sim: 1, pick: { roll: 'a' } },
    });
    expect(odd).toMatchObject({
      day: -1,
      official: 'none',
      best: null,
      streak: 4,
      bestStreak: 4,
      pick: null,
    });
    expect(sanitizeDaily(null).streak).toBe(0);
  });
});
