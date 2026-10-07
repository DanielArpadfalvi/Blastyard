/**
 * Challenge progress (T5.2): best stars per level, persisted as JSON through the platform
 * key-value store, plus the unlock rules. Until the versioned `save.v1` arrives (T6.2) it lives
 * under its own key; corrupt data falls back to "nothing played" without a crash.
 *
 * Unlocking (PLAN §1.9): world 1 is free and opens level by level (a level needs one star on the
 * previous one); worlds 2 and 3 need Blastyard+ and then have no star gates, so a buyer gets what
 * they bought at once. Pure apart from the injected store.
 */

import { LEVELS, LEVELS_PER_WORLD, worldNeedsPlus } from '../content/challenges';
import type { LevelDef } from './challenge';
import type { KeyValueStore } from '../platform/storage';

export const PROGRESS_KEY = 'blastyard.challenges.v1';
export const MAX_STARS = 3;

export type LockState = 'open' | 'locked-plus' | 'locked-progress';

export class ChallengeProgress {
  private stars: Record<string, number> = {};
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore) {
    this.stars = this.load();
  }

  private load(): Record<string, number> {
    const raw = this.store.get(PROGRESS_KEY);
    if (raw === null) return {};
    try {
      const data = JSON.parse(raw) as unknown;
      const out: Record<string, number> = {};
      if (data !== null && typeof data === 'object') {
        for (const level of LEVELS) {
          const v = (data as Record<string, unknown>)[level.id];
          if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_STARS) {
            out[level.id] = v;
          }
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Best stars of a level (0 = not completed). */
  starsOf(id: string): number {
    return this.stars[id] ?? 0;
  }

  /** Records a result; only improvements are kept. Returns true when the best changed. */
  record(id: string, stars: number): boolean {
    const clamped = Math.min(MAX_STARS, Math.max(0, Math.floor(stars)));
    if (clamped <= this.starsOf(id) || !LEVELS.some((l) => l.id === id)) return false;
    this.stars = { ...this.stars, [id]: clamped };
    this.store.set(PROGRESS_KEY, JSON.stringify(this.stars));
    for (const fn of this.listeners) fn();
    return true;
  }

  totalStars(): number {
    return Object.values(this.stars).reduce((a, b) => a + b, 0);
  }

  worldStars(world: number): number {
    return LEVELS.filter((l) => l.world === world).reduce((a, l) => a + this.starsOf(l.id), 0);
  }

  completed(world: number): number {
    return LEVELS.filter((l) => l.world === world && this.starsOf(l.id) > 0).length;
  }

  /** Why a level can or cannot be played with the given entitlement. */
  lockOf(level: LevelDef, hasPlus: boolean): LockState {
    if (worldNeedsPlus(level.world)) return hasPlus ? 'open' : 'locked-plus';
    if (level.index <= 1) return 'open';
    const prev = LEVELS.find((l) => l.world === level.world && l.index === level.index - 1);
    return prev && this.starsOf(prev.id) > 0 ? 'open' : 'locked-progress';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export { LEVELS_PER_WORLD };
