/**
 * Daily challenge progress (T5.3): today's best result, the one "official" attempt, the streak of
 * days won in a row, and where today's prepared challenge was found (so reopening the app skips
 * the bot search). JSON through the platform key-value store; every field is validated and
 * anything wrong falls back to "nothing played" – a corrupt entry never breaks the game.
 *
 * - The first attempt started on a day is the *official* one; its result is kept apart from the
 *   best of all attempts (leaving it unfinished still uses it up). Later attempts are practice.
 * - The streak counts consecutive days with a won daily (any attempt); missing a day resets it.
 *
 * Days are day numbers (`daily.ts` `dayNumber`) taken from the platform clock by the caller.
 */

import { SIM_VERSION } from '../core';
import type { KeyValueStore } from '../platform/storage';
import type { DailyPick } from './daily';

export const DAILY_KEY = 'blastyard.daily.v1';

export interface DailyRecord {
  readonly won: boolean;
  /** 0 when lost, else 1–3. */
  readonly stars: number;
  /** Playing ticks the attempt took. */
  readonly ticks: number;
}

/** The official attempt of a day: not yet started, started (unfinished), or its result. */
export type OfficialState = 'none' | 'started' | DailyRecord;

/** What a finished daily attempt reports next to the usual challenge result. */
export interface DailyOutcome {
  readonly day: number;
  readonly official: boolean;
  /** This attempt is the day's new best. */
  readonly newBest: boolean;
  readonly view: DailyView;
}

export interface DailyView {
  readonly official: OfficialState;
  /** Best attempt of the day (more stars, then less time), or null. */
  readonly best: DailyRecord | null;
  readonly attempts: number;
  /** Days won in a row up to today (or yesterday, while today is still open). */
  readonly streak: number;
  readonly bestStreak: number;
  readonly wonToday: boolean;
}

interface DailySave {
  /** The day `official`, `best` and `attempts` belong to. */
  readonly day: number;
  readonly official: OfficialState;
  readonly best: DailyRecord | null;
  readonly attempts: number;
  readonly streak: number;
  /** Last day with a won daily (−1 = never). */
  readonly lastWonDay: number;
  readonly bestStreak: number;
  readonly pick: { readonly day: number; readonly sim: number; readonly pick: DailyPick } | null;
}

const EMPTY: DailySave = {
  day: -1,
  official: 'none',
  best: null,
  attempts: 0,
  streak: 0,
  lastWonDay: -1,
  bestStreak: 0,
  pick: null,
};

const isInt = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;

function record(raw: unknown): DailyRecord | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.won !== 'boolean' || !isInt(o.stars) || o.stars > 3 || !isInt(o.ticks)) return null;
  if (o.won !== o.stars > 0) return null;
  return { won: o.won, stars: o.stars, ticks: o.ticks };
}

/** Validates an untrusted stored value field by field. */
export function sanitizeDaily(raw: unknown): DailySave {
  if (raw === null || typeof raw !== 'object') return EMPTY;
  const o = raw as Record<string, unknown>;
  const official: OfficialState =
    o.official === 'none' || o.official === 'started' ? o.official : (record(o.official) ?? 'none');
  let pick: DailySave['pick'] = null;
  if (o.pick !== null && typeof o.pick === 'object') {
    const p = o.pick as Record<string, unknown>;
    const inner = (p.pick ?? {}) as Record<string, unknown>;
    if (isInt(p.day) && isInt(p.sim) && isInt(inner.roll) && isInt(inner.attempt)) {
      pick = { day: p.day, sim: p.sim, pick: { roll: inner.roll, attempt: inner.attempt } };
    }
  }
  const streak = isInt(o.streak) ? o.streak : 0;
  return {
    day: isInt(o.day) ? o.day : -1,
    official,
    best: record(o.best),
    attempts: isInt(o.attempts) ? o.attempts : 0,
    streak,
    lastWonDay: isInt(o.lastWonDay) ? o.lastWonDay : -1,
    bestStreak: Math.max(streak, isInt(o.bestStreak) ? o.bestStreak : 0),
    pick,
  };
}

/** Is `a` a better daily result than `b`? */
export function betterRecord(a: DailyRecord, b: DailyRecord | null): boolean {
  if (!b) return true;
  if (a.stars !== b.stars) return a.stars > b.stars;
  return a.won && a.ticks < b.ticks;
}

export class DailyStore {
  private data: DailySave;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore) {
    this.data = this.load();
  }

  private load(): DailySave {
    const raw = this.store.get(DAILY_KEY);
    if (raw === null) return EMPTY;
    try {
      return sanitizeDaily(JSON.parse(raw));
    } catch {
      return EMPTY;
    }
  }

  private save(next: DailySave): void {
    this.data = next;
    this.store.set(DAILY_KEY, JSON.stringify(next));
    for (const fn of this.listeners) fn();
  }

  /** The stored data rolled over to `day` (yesterday's attempts do not carry). */
  private on(day: number): DailySave {
    const d = this.data;
    return d.day === day ? d : { ...d, day, official: 'none', best: null, attempts: 0 };
  }

  view(day: number): DailyView {
    const d = this.on(day);
    return {
      official: d.official,
      best: d.best,
      attempts: d.attempts,
      streak: d.lastWonDay >= day - 1 ? d.streak : 0,
      bestStreak: d.bestStreak,
      wonToday: d.lastWonDay === day,
    };
  }

  /** Starts an attempt on `day`; returns true when it is the official one. */
  beginAttempt(day: number): boolean {
    const d = this.on(day);
    const official = d.official === 'none';
    this.save({ ...d, attempts: d.attempts + 1, official: official ? 'started' : d.official });
    return official;
  }

  /** Records a finished attempt (`official` as returned by {@link beginAttempt}). */
  finish(day: number, official: boolean, result: DailyRecord): void {
    let d = this.on(day);
    if (official && d.official === 'started') d = { ...d, official: result };
    if (betterRecord(result, d.best)) d = { ...d, best: result };
    if (result.won && d.lastWonDay !== day) {
      const streak = d.lastWonDay === day - 1 ? d.streak + 1 : 1;
      d = { ...d, streak, lastWonDay: day, bestStreak: Math.max(d.bestStreak, streak) };
    }
    this.save(d);
  }

  /** Where `day`'s challenge was found earlier with this simulation version, if known. */
  pickFor(day: number): DailyPick | null {
    const p = this.data.pick;
    return p && p.day === day && p.sim === SIM_VERSION ? p.pick : null;
  }

  rememberPick(day: number, pick: DailyPick): void {
    this.save({ ...this.data, pick: { day, sim: SIM_VERSION, pick } });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
