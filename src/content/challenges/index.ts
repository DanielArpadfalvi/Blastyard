/** The challenge campaign content: 36 levels, their tuning (seeds, star thresholds) and helpers. */

import type { LevelTuning } from '../../game/challenge';
import { LEVELS } from './levels';
import { TUNING } from './tuning';

export {
  LEVELS,
  LEVELS_PER_WORLD,
  WORLD_COUNT,
  isGauntlet,
  levelById,
  worldLevels,
  worldNeedsPlus,
} from './levels';
export { TUNING } from './tuning';

/** Seeds and star thresholds of a level (every built-in level has them). */
export function tuningOf(id: string): LevelTuning {
  const tuning = TUNING[id];
  if (!tuning) throw new Error(`level ${id} has no tuning – run scripts/solve-challenges.ts`);
  return tuning;
}

/** The level after `id` in campaign order, if any. */
export function nextLevel(id: string): (typeof LEVELS)[number] | undefined {
  const at = LEVELS.findIndex((l) => l.id === id);
  return at >= 0 ? LEVELS[at + 1] : undefined;
}
