// Authoring tool for the challenge campaign (T5.2): lets an Expert bot play every level through the
// real simulation as the *player* (seat 0), finds a seed per stage that it wins, records the bot's
// inputs as the reference solution and derives the star thresholds from what it needed.
//
//   node scripts/run-ts.mjs scripts/solve-challenges.ts [--level w1-03] [--tries 60] [--probe] [--write]
//
// - without `--write` it only reports (and `--probe` lists every attempt);
// - with `--write` it regenerates src/content/challenges/tuning.ts and solutions.ts (all levels
//   must be solvable, or the file is not touched). Run `npm run format` afterwards.
//
// The bot drives seat 0 through `botInput` with a temporary bot level; the recorded input bytes are
// what a human would have to press, and `replayLevel` re-checks every solution with a plain human
// seat 0, which is exactly what `scripts/validate-content.ts` does in `npm run check`.

import { writeFileSync } from 'node:fs';
import { rleEncode, type InputRLE } from '../src/core';
import { replayLevel, type LevelDef, type RunStats, type StarCond } from '../src/game/challenge';
import { botPlay, qualifies, starsFromRun } from '../src/game/solver';
import { LEVELS } from '../src/content/challenges/levels';
import { TUTORIAL, chainOpening } from '../src/content/tutorial';

interface Args {
  level: string | null;
  tries: number;
  probe: boolean;
  write: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { level: null, tries: 60, probe: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--level') args.level = argv[++i] ?? null;
    else if (a === '--tries') args.tries = Number(argv[++i] ?? 60);
    else if (a === '--probe') args.probe = true;
    else if (a === '--write') args.write = true;
  }
  return args;
}

interface Solved {
  readonly seeds: number[];
  readonly logs: InputRLE[];
  readonly hashes: string[];
  readonly stars: [StarCond, StarCond];
  readonly stats: RunStats;
}

function solveLevel(level: LevelDef, args: Args): Solved | null {
  const seeds: number[] = [];
  const logs: InputRLE[] = [];
  for (let k = 0; k < level.stages.length; k++) {
    const base = (level.world * 100 + level.index) * 1000 + k * 100;
    let found = false;
    const tally: string[] = [];
    for (let attempt = 0; attempt < args.tries && !found; attempt++) {
      const seed = base + attempt;
      const opening = level.stages[k]!.objective.type === 'chain' ? chainOpening() : [];
      const run = botPlay(level, k, seed, opening);
      const secs = (run.stats.ticks / 60).toFixed(0);
      tally.push(`${run.reason}${run.won ? `@${secs}s` : ''}`);
      if (args.probe) {
        console.log(
          `  ${level.id}/${k + 1} seed ${seed}: ${run.reason} ${secs}s bombs ${run.stats.bombs} ` +
            `pickups ${run.stats.pickups} dmg ${run.stats.damage} kills ${run.stats.kills}`,
        );
      }
      // The reference leaves room: at most 60 % of the objective's time limit.
      if (!qualifies(level, k, run)) continue;
      seeds.push(seed);
      logs.push(rleEncode(run.bytes));
      found = true;
    }
    if (!found) {
      console.log(
        `  ${level.id} stage ${k + 1}: no seed in ${args.tries} tries (${tally.slice(0, 12).join(' ')})`,
      );
      return null;
    }
  }
  // Verify with a plain human seat 0, derive the thresholds from that run.
  const replay = replayLevel(level, seeds, logs);
  if (replay.status !== 'won') {
    console.log(`  ${level.id}: the recorded solution does not replay (${replay.status})`);
    return null;
  }
  // Trim every log to the tick its stage was won.
  const trimmed = logs.map((log, k) => {
    const ticks = replay.ticks[k] as number;
    const out: InputRLE = [];
    let left = ticks;
    for (let i = 0; i < log.length && left > 0; i += 2) {
      const take = Math.min(left, log[i + 1] as number);
      out.push(log[i] as number, take);
      left -= take;
    }
    return out;
  });
  const again = replayLevel(level, seeds, trimmed);
  if (again.status !== 'won') {
    console.log(`  ${level.id}: trimmed solution does not replay`);
    return null;
  }
  const stars = starsFromRun(level, again.stats);
  // Re-hash at the winning ticks (the hashes in `again` are those of the trimmed replay).
  return { seeds, logs: trimmed, hashes: [...again.hashes], stars, stats: again.stats };
}

function fmtCond(c: StarCond): string {
  switch (c.kind) {
    case 'time':
      return `{ kind: 'time', seconds: ${c.seconds} }`;
    case 'bombs':
      return `{ kind: 'bombs', max: ${c.max} }`;
    case 'pickups':
      return `{ kind: 'pickups', min: ${c.min} }`;
    case 'noDamage':
      return `{ kind: 'noDamage' }`;
  }
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  const levels = [...LEVELS, TUTORIAL].filter((l) => args.level === null || l.id === args.level);
  const solved = new Map<string, Solved>();
  let failures = 0;
  const started = Date.now();
  for (const level of levels) {
    const t0 = Date.now();
    const result = solveLevel(level, args);
    if (!result) {
      failures++;
      console.log(`${level.id}: FAILED`);
      continue;
    }
    solved.set(level.id, result);
    console.log(
      `${level.id}: ok seeds [${result.seeds.join(', ')}] ${(result.stats.ticks / 60).toFixed(0)}s ` +
        `bombs ${result.stats.bombs} pickups ${result.stats.pickups} dmg ${result.stats.damage} ` +
        `stars ${result.stars.map(fmtCond).join(' ')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  }
  console.log(
    `${solved.size}/${levels.length} levels solved in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  if (!args.write) return failures === 0 ? 0 : 1;
  if (failures > 0 || args.level !== null) {
    console.log('not writing: need every level solved and no --level filter');
    return 1;
  }
  const tuning = [...solved.entries()]
    .map(
      ([id, s]) =>
        `  '${id}': { seeds: [${s.seeds.join(', ')}], stars: [${s.stars.map(fmtCond).join(', ')}] },`,
    )
    .join('\n');
  writeFileSync(
    'src/content/challenges/tuning.ts',
    `// GENERATED by scripts/solve-challenges.ts – do not edit by hand.\n` +
      `import type { LevelTuning } from '../../game/challenge';\n\n` +
      `/** Seed per stage and star thresholds of every level. */\n` +
      `export const TUNING: Readonly<Record<string, LevelTuning>> = {\n${tuning}\n};\n`,
  );
  const solutions = [...solved.entries()]
    .map(
      ([id, s]) =>
        `  '${id}': {\n    logs: ${JSON.stringify(s.logs)},\n    hashes: ${JSON.stringify(s.hashes)},\n  },`,
    )
    .join('\n');
  writeFileSync(
    'src/content/challenges/solutions.ts',
    `// GENERATED by scripts/solve-challenges.ts – do not edit by hand.\n` +
      `// Reference solutions: the player's input bytes per tick (RLE) per stage and the state hash at\n` +
      `// the tick each stage was won. Only scripts and tests import this file (not the game).\n` +
      `import type { LevelSolution } from '../../game/challenge';\n\n` +
      `export const SOLUTIONS: Readonly<Record<string, LevelSolution>> = {\n${solutions}\n};\n`,
  );
  console.log('wrote tuning.ts and solutions.ts');
  return 0;
}
