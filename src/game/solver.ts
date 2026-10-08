/**
 * Bot solver for challenge stages: an Expert bot plays a stage through the real simulation as the
 * *player* (seat 0) and its input bytes are recorded – exactly what a human would have to press.
 * Star thresholds are derived from what the bot needed.
 *
 * Shared by the campaign authoring script (`scripts/solve-challenges.ts`) and the daily challenge
 * (T5.3), which proves every generated day winnable before it is offered. Pure and deterministic.
 */

import { BotLevel, MAX_SEATS, botInput, createState, setBotLevel, step } from '../core';
import {
  ChallengeTracker,
  PLAYER_SEAT,
  stageSetup,
  type LevelDef,
  type RunStats,
  type StarCond,
  type StarKind,
} from './challenge';

/** One stage of `level` as a level of its own (so the tracker measures just that stage). */
export function singleStage(level: LevelDef, k: number): LevelDef {
  return { ...level, stages: [level.stages[k] as LevelDef['stages'][number]] };
}

export interface StageRun {
  readonly won: boolean;
  /** The player's input byte per tick. */
  readonly bytes: number[];
  readonly stats: RunStats;
  /** `won`, a loss reason, or `cap` when the tick budget ran out. */
  readonly reason: string;
}

/**
 * The bot plays stage `k` of `level` with `seed`; the player's input bytes are recorded. An
 * `opening` (input bytes from tick 0) is played first, the bot takes over after it.
 */
export function botPlay(
  level: LevelDef,
  k: number,
  seed: number,
  opening: readonly number[] = [],
): StageRun {
  const single = singleStage(level, k);
  const state = createState(stageSetup(level, k, seed));
  const tracker = new ChallengeTracker(single);
  const objective = single.stages[0]!.objective;
  const rules = single.stages[0]!.rules;
  const roundTicks = (rules?.roundSeconds ?? 0) * 60;
  const cap =
    180 +
    (objective.seconds !== undefined ? objective.seconds * 60 + 60 : 0) +
    (roundTicks > 0 ? roundTicks + 4000 : 7200);
  const inputs = new Uint8Array(MAX_SEATS);
  const bytes: number[] = [];
  inputs[PLAYER_SEAT] = opening[0] ?? 0;
  let events = step(state, inputs);
  bytes.push(inputs[PLAYER_SEAT] as number);
  tracker.observe(state, events);
  while (tracker.status === 'running' && bytes.length < cap) {
    let input = opening[bytes.length];
    if (input === undefined) {
      setBotLevel(state, PLAYER_SEAT, BotLevel.EXPERT);
      input = botInput(state, PLAYER_SEAT);
      setBotLevel(state, PLAYER_SEAT, BotLevel.NONE);
    }
    inputs[PLAYER_SEAT] = input;
    bytes.push(input);
    events = step(state, inputs);
    tracker.observe(state, events);
  }
  const won = tracker.status === 'won';
  return {
    won,
    bytes,
    stats: tracker.totals(),
    reason: won ? 'won' : (tracker.lossReason ?? 'cap'),
  };
}

function roundUp5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/**
 * Star condition of `kind` derived from a bot run: the bot is a perfect runner, so the thresholds
 * leave human headroom (`strict` is the harder third star). `limit` caps a time star below the
 * objective's own time limit.
 */
export function condFor(
  kind: StarKind,
  stats: RunStats,
  strict: boolean,
  limit: number | null,
): StarCond {
  const seconds = stats.ticks / 60;
  switch (kind) {
    case 'time': {
      let value = strict ? roundUp5(seconds * 1.4) : roundUp5(seconds * 2);
      value = Math.max(value, Math.ceil(seconds) + (strict ? 4 : 10));
      if (limit !== null) value = Math.min(value, Math.floor(limit * (strict ? 0.6 : 0.85)));
      return { kind: 'time', seconds: Math.max(value, Math.ceil(seconds) + 2) };
    }
    case 'bombs':
      return {
        kind: 'bombs',
        max: strict ? Math.ceil(stats.bombs * 1.3) + 2 : Math.ceil(stats.bombs * 1.8) + 3,
      };
    case 'pickups':
      return {
        kind: 'pickups',
        min: Math.max(1, Math.floor(stats.pickups * (strict ? 0.8 : 0.5))),
      };
    case 'noDamage':
      return { kind: 'noDamage' };
  }
}

/**
 * Does a run of stage `k` qualify as a reference: won, consistent with the level's star kinds,
 * and – for a timed objective other than `survive` – within 60 % of the time limit, so a human
 * has room.
 */
export function qualifies(level: LevelDef, k: number, run: StageRun): boolean {
  if (!run.won) return false;
  if (level.stars.includes('noDamage') && run.stats.damage > 0) return false;
  if (level.stars.includes('pickups') && run.stats.pickups < 1) return false;
  const objective = level.stages[k]!.objective;
  const limit = objective.seconds;
  if (limit !== undefined && objective.type !== 'survive' && run.stats.ticks > limit * 36) {
    return false;
  }
  return true;
}

/** Star thresholds of a single-stage level from its qualifying reference run. */
export function starsFromRun(level: LevelDef, stats: RunStats): [StarCond, StarCond] {
  const limits = level.stages.map((st) => st.objective.seconds ?? null);
  const limit = limits.every((l) => l !== null)
    ? limits.reduce<number>((a, l) => a + (l ?? 0), 0)
    : null;
  return [
    condFor(level.stars[0], stats, false, limit),
    condFor(level.stars[1], stats, true, limit),
  ];
}
