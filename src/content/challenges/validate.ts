/**
 * Content validation for the challenge campaign (T5.2): structure of the 36 levels, arenas, monster
 * and flag placement, and – the important part – a replay of every reference solution through the
 * real simulation. `scripts/validate-content.ts` runs it inside `npm run check`; the unit tests
 * call it too. A failing replay after a simulation change means `SIM_VERSION` must be bumped and
 * `scripts/solve-challenges.ts --write` re-run (CLAUDE.md).
 */

import type { ArenaDef } from '../../core';
import { GRID_W, MAX_MONSTERS, loadArena, validateArena } from '../../core';
import {
  replayLevel,
  starsFor,
  stageSetup,
  type LevelDef,
  type LevelSolution,
} from '../../game/challenge';
import { en } from '../../i18n/en';
import { hu } from '../../i18n/hu';
import { ALL_ARENAS } from '../arenas';
import { TUTORIAL, TUTORIAL_ID, TUTORIAL_STEPS } from '../tutorial';
import { LEVELS, LEVELS_PER_WORLD, WORLD_COUNT } from './levels';
import { TUNING } from './tuning';

export interface ContentIssue {
  readonly where: string;
  readonly message: string;
}

/** Monsters keep at least this many tiles (Manhattan) from the player's spawn. */
export const MONSTER_SPAWN_MARGIN = 6;

function manhattan(a: number, b: number): number {
  return (
    Math.abs((a % GRID_W) - (b % GRID_W)) +
    Math.abs(Math.floor(a / GRID_W) - Math.floor(b / GRID_W))
  );
}

/** Every distinct arena used by the levels (variants included). */
export function challengeArenas(levels: readonly LevelDef[] = LEVELS): ArenaDef[] {
  const seen = new Map<string, ArenaDef>();
  for (const l of levels) for (const s of l.stages) seen.set(s.arena.id, s.arena);
  return [...seen.values()];
}

/** Structure checks of one level (no simulation). */
export function validateLevelStructure(level: LevelDef): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const bad = (message: string): void => {
    issues.push({ where: level.id, message });
  };
  if (level.stages.length === 0) bad('no stages');
  if (level.id === TUTORIAL_ID) {
    if (level.stages.length !== TUTORIAL_STEPS) bad(`the tutorial needs ${TUTORIAL_STEPS} steps`);
  } else {
    if (level.index === LEVELS_PER_WORLD && level.stages.length < 2)
      bad('a gauntlet needs 2+ stages');
    if (level.index !== LEVELS_PER_WORLD && level.stages.length !== 1)
      bad('only gauntlets have stages');
  }
  if (!(level.nameKey in en) || !(level.nameKey in hu)) bad(`missing level name ${level.nameKey}`);
  level.stages.forEach((stage, k) => {
    const tag = `stage ${k + 1}`;
    const check = validateArena(stage.arena);
    if (!check.ok || !check.parsed) {
      bad(
        `${tag}: arena ${stage.arena.id} invalid: ${check.errors.map((e) => e.message).join('; ')}`,
      );
      return;
    }
    const spawn = check.parsed.spawns[0] as number;
    const floor = (x: number, y: number): boolean => check.parsed!.cells[y * GRID_W + x] === 0;
    const monsters = stage.monsters ?? [];
    if (monsters.length > MAX_MONSTERS) bad(`${tag}: too many monsters`);
    for (const m of monsters) {
      if (!floor(m.x, m.y)) bad(`${tag}: monster at (${m.x}, ${m.y}) is not on plain floor`);
      else if (manhattan(m.y * GRID_W + m.x, spawn) < MONSTER_SPAWN_MARGIN) {
        bad(`${tag}: monster at (${m.x}, ${m.y}) starts too close to the player`);
      }
    }
    const o = stage.objective;
    if (o.type === 'flag') {
      if (!stage.flag) bad(`${tag}: flag objective without a flag`);
      else if (!floor(stage.flag.x, stage.flag.y)) bad(`${tag}: flag is not on plain floor`);
      else if (manhattan(stage.flag.y * GRID_W + stage.flag.x, spawn) < 8) {
        bad(`${tag}: flag is too close to the start`);
      }
    }
    if (o.type === 'monsters' && monsters.length === 0)
      bad(`${tag}: monster objective, no monsters`);
    if ((o.type === 'collect' || o.type === 'chain') && (o.count ?? 0) < 1) {
      bad(`${tag}: ${o.type} needs a count`);
    }
    if ((o.type === 'survive' || o.type === 'collect' || o.type === 'crates') && !o.seconds) {
      bad(`${tag}: ${o.type} needs seconds`);
    }
    if ((o.type === 'survive' || o.type === 'win') && (stage.bots ?? []).length === 0) {
      bad(`${tag}: ${o.type} needs bots`);
    }
    if (o.type === 'win' && !stage.rules?.roundSeconds) bad(`${tag}: a duel needs a round clock`);
    try {
      loadArena(stage.arena);
      stageSetup(level, k, 1);
    } catch (e) {
      bad(`${tag}: ${(e as Error).message}`);
    }
  });
  return issues;
}

/** Replays the reference solution of `level` and checks it wins with three stars. */
export function validateLevelSolution(
  level: LevelDef,
  solution: LevelSolution | undefined,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const bad = (message: string): void => {
    issues.push({ where: level.id, message });
  };
  const tuning = TUNING[level.id];
  if (!tuning) return [{ where: level.id, message: 'no tuning (run scripts/solve-challenges.ts)' }];
  if (!solution) return [{ where: level.id, message: 'no reference solution' }];
  if (tuning.seeds.length !== level.stages.length) bad('seed count differs from the stage count');
  if (solution.logs.length !== level.stages.length)
    bad('solution log count differs from the stage count');
  tuning.stars.forEach((c, i) => {
    if (c.kind !== level.stars[i])
      bad(`star ${i + 2} is '${c.kind}', the level declares '${level.stars[i]}'`);
  });
  if (issues.length > 0) return issues;
  const result = replayLevel(level, tuning.seeds, solution.logs);
  if (result.status !== 'won') {
    bad(
      `reference solution does not win (${result.status}${result.lossReason ? `: ${result.lossReason}` : ''}, ` +
        `${result.stagesWon}/${level.stages.length} stages)`,
    );
    return issues;
  }
  solution.hashes.forEach((h, k) => {
    if (result.hashes[k] !== h) {
      bad(
        `stage ${k + 1}: state hash ${result.hashes[k]} differs from the recorded ${h} (simulation changed?)`,
      );
    }
  });
  const stars = starsFor(true, result.stats, tuning.stars);
  if (stars !== 3) bad(`reference solution earns ${stars} stars, expected 3`);
  return issues;
}

/** All content checks: arenas, level structure and every reference solution. */
export function validateContent(
  solutions: Readonly<Record<string, LevelSolution>>,
  onLevel?: (id: string, issues: number) => void,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  for (const arena of ALL_ARENAS) {
    const check = validateArena(arena);
    if (!check.ok) {
      issues.push({
        where: `arena ${arena.id}`,
        message: check.errors.map((e) => e.message).join('; '),
      });
    }
  }
  if (LEVELS.length !== WORLD_COUNT * LEVELS_PER_WORLD) {
    issues.push({
      where: 'levels',
      message: `expected ${WORLD_COUNT * LEVELS_PER_WORLD} levels, found ${LEVELS.length}`,
    });
  }
  const ids = new Set<string>();
  for (const level of [...LEVELS, TUTORIAL]) {
    if (ids.has(level.id)) issues.push({ where: level.id, message: 'duplicate level id' });
    ids.add(level.id);
    const found = [
      ...validateLevelStructure(level),
      ...validateLevelSolution(level, solutions[level.id]),
    ];
    issues.push(...found);
    onLevel?.(level.id, found.length);
  }
  for (const id of Object.keys(solutions)) {
    if (!ids.has(id)) issues.push({ where: id, message: 'solution for an unknown level' });
  }
  return issues;
}
