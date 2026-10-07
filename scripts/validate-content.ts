// Validates the shipped content (arenas, the 36 challenge levels) and replays every reference
// solution through the real simulation. Part of `npm run check`.
//   node scripts/run-ts.mjs scripts/validate-content.ts
// After a deliberate simulation change: bump SIM_VERSION, then `npm run solve:challenges` to
// regenerate seeds / thresholds / solutions (see CLAUDE.md).

import { SOLUTIONS } from '../src/content/challenges/solutions';
import { validateContent } from '../src/content/challenges/validate';
import { ALL_ARENAS } from '../src/content/arenas';
import { LEVELS } from '../src/content/challenges/levels';
import { SIM_VERSION } from '../src/core';

export function main(): number {
  const started = Date.now();
  const issues = validateContent(SOLUTIONS);
  if (issues.length > 0) {
    for (const i of issues) console.error(`content: ${i.where}: ${i.message}`);
    console.error(`content: ${issues.length} problem(s) (SIM_VERSION ${SIM_VERSION})`);
    return 1;
  }
  console.log(
    `content ok: ${ALL_ARENAS.length} arenas, ${LEVELS.length} challenge levels replayed ` +
      `(SIM_VERSION ${SIM_VERSION}, ${Date.now() - started} ms)`,
  );
  return 0;
}
