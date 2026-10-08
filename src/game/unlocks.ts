/**
 * Milestone unlocks (T6.2, PLAN §1.9): free cosmetics open up by playing – matches played,
 * matches won, challenge stars, best daily streak; Plus items with Blastyard+. No currency.
 * Pure: everything is derived from the lifetime stats, the stars and the daily store.
 */

import type { CosmeticItem, Unlock } from '../content/cosmetics';
import type { LifetimeStats } from './stats';

/** The numbers milestones and trophies look at. */
export interface ProgressContext {
  readonly stats: LifetimeStats;
  /** Challenge stars in total. */
  readonly stars: number;
  /** Best daily streak ever. */
  readonly bestStreak: number;
  readonly hasPlus: boolean;
  /** Owns the Supporter pack (cosmetic thanks). */
  readonly hasSupporter?: boolean;
}

/** How far `unlock` is: `have` of `need` (both 1 / 0 for start and Plus items). */
export function unlockProgress(
  unlock: Unlock,
  ctx: ProgressContext,
): { have: number; need: number } {
  switch (unlock.kind) {
    case 'start':
      return { have: 1, need: 1 };
    case 'plus':
      return { have: ctx.hasPlus ? 1 : 0, need: 1 };
    case 'supporter':
      return { have: ctx.hasSupporter === true ? 1 : 0, need: 1 };
    case 'matches':
      return { have: ctx.stats.matches, need: unlock.n };
    case 'wins':
      return { have: ctx.stats.wins, need: unlock.n };
    case 'stars':
      return { have: ctx.stars, need: unlock.n };
    case 'streak':
      return { have: ctx.bestStreak, need: unlock.n };
  }
}

export function isUnlocked(item: CosmeticItem, ctx: ProgressContext): boolean {
  const p = unlockProgress(item.unlock, ctx);
  return p.have >= p.need;
}

/** Items of `items` unlocked in `after` but not in `before` (a "new!" notice). */
export function newlyUnlocked<T extends CosmeticItem>(
  items: readonly T[],
  before: ProgressContext,
  after: ProgressContext,
): T[] {
  return items.filter((i) => !isUnlocked(i, before) && isUnlocked(i, after));
}
