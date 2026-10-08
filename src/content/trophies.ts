/**
 * The 20 local trophies (T6.2, PLAN §1.9). Nothing leaves the device; each trophy is a test over
 * the player's progress, so they need no storage of their own and can never get out of sync.
 * Names and descriptions: i18n `trophy_<id>` / `trophyDesc_<id>`.
 */

import type { ProgressContext } from '../game/unlocks';
import { LEVELS_PER_WORLD } from './challenges/levels';

export interface TrophyContext extends ProgressContext {
  /** Best stars per challenge level id. */
  readonly starsOf: (levelId: string) => number;
  readonly tutorialDone: boolean;
}

export interface TrophyDef {
  readonly id: string;
  /** Current value and the target (shown as progress). */
  readonly progress: (ctx: TrophyContext) => { have: number; need: number };
}

const at = (have: number, need: number) => ({ have: Math.min(have, need), need });
const counter = (id: string, need: number, value: (ctx: TrophyContext) => number): TrophyDef => ({
  id,
  progress: (ctx) => at(value(ctx), need),
});

function worldDone(ctx: TrophyContext, world: number): number {
  let n = 0;
  for (let i = 1; i <= LEVELS_PER_WORLD; i++) {
    if (ctx.starsOf(`w${world}-${String(i).padStart(2, '0')}`) > 0) n++;
  }
  return n;
}

export const TROPHIES: readonly TrophyDef[] = [
  counter('firstMatch', 1, (c) => c.stats.matches),
  counter('firstWin', 1, (c) => c.stats.wins),
  counter('matches10', 10, (c) => c.stats.matches),
  counter('matches50', 50, (c) => c.stats.matches),
  counter('wins10', 10, (c) => c.stats.wins),
  counter('wins50', 50, (c) => c.stats.wins),
  counter('ko10', 10, (c) => c.stats.knockouts),
  counter('ko100', 100, (c) => c.stats.knockouts),
  counter('pops500', 500, (c) => c.stats.pops),
  counter('powerUps100', 100, (c) => c.stats.powerUps),
  counter('cleanWin', 1, (c) => c.stats.cleanWins),
  counter('tutorial', 1, (c) => (c.tutorialDone ? 1 : 0)),
  counter('firstStar', 1, (c) => c.stars),
  counter('stars30', 30, (c) => c.stars),
  counter('stars108', 108, (c) => c.stars),
  counter('world1', LEVELS_PER_WORLD, (c) => worldDone(c, 1)),
  counter('gauntlet', 1, (c) => ([1, 2, 3].some((w) => c.starsOf(`w${w}-12`) > 0) ? 1 : 0)),
  counter('dailyWin', 1, (c) => c.stats.dailyWins),
  counter('streak3', 3, (c) => c.bestStreak),
  counter('streak7', 7, (c) => c.bestStreak),
];

export function trophyEarned(def: TrophyDef, ctx: TrophyContext): boolean {
  const p = def.progress(ctx);
  return p.have >= p.need;
}
