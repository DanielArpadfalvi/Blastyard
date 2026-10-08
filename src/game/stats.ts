/**
 * Lifetime statistics (T6.2, PLAN §1.9): matches, wins, knock-outs, own-pop knock-outs, pops,
 * power-ups, favourite arena, challenge and daily wins. They feed the stats screen, the trophies
 * and the milestone unlocks. Only matches with a human player count, summed over the human
 * seats (one shared device). JSON through the save; every field validated.
 */

import type { KeyValueStore } from '../platform/storage';
import type { MatchResult } from './session';

export const STATS_KEY = 'blastyard.stats.v1';

export interface LifetimeStats {
  readonly matches: number;
  /** Matches a human seat (or a human's team) won. */
  readonly wins: number;
  /** Won matches in which no human knocked themselves out. */
  readonly cleanWins: number;
  readonly knockouts: number;
  readonly selfKnockouts: number;
  readonly pops: number;
  readonly powerUps: number;
  /** Matches played per arena id. */
  readonly arenas: Readonly<Record<string, number>>;
  readonly challengesWon: number;
  readonly dailyWins: number;
}

export const EMPTY_STATS: LifetimeStats = {
  matches: 0,
  wins: 0,
  cleanWins: 0,
  knockouts: 0,
  selfKnockouts: 0,
  pops: 0,
  powerUps: 0,
  arenas: {},
  challengesWon: 0,
  dailyWins: 0,
};

const COUNTERS = [
  'matches',
  'wins',
  'cleanWins',
  'knockouts',
  'selfKnockouts',
  'pops',
  'powerUps',
  'challengesWon',
  'dailyWins',
] as const;

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;

export function sanitizeStats(raw: unknown): LifetimeStats {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of COUNTERS) out[k] = count(o[k]);
  const arenas: Record<string, number> = {};
  if (o.arenas !== null && typeof o.arenas === 'object' && !Array.isArray(o.arenas)) {
    for (const [id, n] of Object.entries(o.arenas as Record<string, unknown>)) {
      if (count(n) > 0) arenas[id] = count(n);
    }
  }
  out.arenas = arenas;
  return out as unknown as LifetimeStats;
}

/** What one finished match adds to the lifetime stats (null when no human played). */
export function matchDelta(result: MatchResult): Partial<LifetimeStats> | null {
  const humans = result.plan.filter((p) => p.kind === 'human').map((p) => p.seat);
  if (humans.length === 0) return null;
  const side = (seat: number): number => (result.teams ? (result.teams[seat] ?? -1) : seat);
  const won = humans.some((s) => side(s) === result.winner);
  let knockouts = 0;
  let selfKnockouts = 0;
  let pops = 0;
  let powerUps = 0;
  for (const s of humans) {
    const st = result.stats[s];
    if (!st) continue;
    knockouts += st.knockouts;
    selfKnockouts += st.selfKnockouts;
    pops += st.pops;
    powerUps += st.powerUps;
  }
  return {
    matches: 1,
    wins: won ? 1 : 0,
    cleanWins: won && selfKnockouts === 0 ? 1 : 0,
    knockouts,
    selfKnockouts,
    pops,
    powerUps,
  };
}

export class StatsStore {
  private value: LifetimeStats;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore) {
    let raw: unknown;
    try {
      raw = JSON.parse(store.get(STATS_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.value = sanitizeStats(raw);
  }

  get(): LifetimeStats {
    return this.value;
  }

  /** Adds a finished match (party, Quick Match, solo, face-off) played on `arenaId`. */
  recordMatch(result: MatchResult, arenaId: string): void {
    const delta = matchDelta(result);
    if (!delta) return;
    this.add(delta, arenaId);
  }

  recordChallengeWin(): void {
    this.add({ challengesWon: 1 });
  }

  recordDailyWin(): void {
    this.add({ dailyWins: 1 });
  }

  /** Most played arena id (ties: the first one reached), or null. */
  favouriteArena(): string | null {
    let best: string | null = null;
    let most = 0;
    for (const [id, n] of Object.entries(this.value.arenas)) {
      if (n > most) {
        best = id;
        most = n;
      }
    }
    return best;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private add(delta: Partial<LifetimeStats>, arenaId?: string): void {
    const v = this.value;
    const next: Record<string, unknown> = { ...v };
    for (const k of COUNTERS) next[k] = v[k] + ((delta[k] as number | undefined) ?? 0);
    next.arenas = arenaId ? { ...v.arenas, [arenaId]: (v.arenas[arenaId] ?? 0) + 1 } : v.arenas;
    this.value = next as unknown as LifetimeStats;
    this.store.set(STATS_KEY, JSON.stringify(this.value));
    for (const fn of this.listeners) fn();
  }
}
