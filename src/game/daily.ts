/**
 * Daily challenge (T5.3, PLAN §1.6): the calendar date seeds one single-stage challenge – an arena
 * variant (a free arena with its own crate density), a modifier (start bonus or rule twist) and an
 * objective. Everyone with the same date gets the same challenge.
 *
 * The date comes from the platform clock ({@link dayNumber} of `localDate()`), never from the
 * core. Generation is pure: {@link dailyCandidate} builds the definition from the day number with
 * an RNG of its own, and {@link prepareDaily} proves it winnable by letting the Expert bot play it
 * as the player (`solver.ts`, the same tool that authors the campaign): the first seed the bot
 * wins with room to spare becomes the day's seed, and the star thresholds come from that run. A
 * day whose candidate the bot cannot win is re-rolled (`roll` 1, 2, …), so every day is playable.
 */

import { FREE_ARENAS } from '../content/arenas';
import { variant } from '../content/challenges/arenas';
import {
  Ability,
  BotLevel,
  GRID_W,
  LayoutCell,
  Monster,
  RngStream,
  createRngWords,
  randInt,
  validateArena,
  type ArenaDef,
  type MonsterSpawn,
  type Rules,
} from '../core';
import type { CalendarDate } from '../platform/clock';
import type {
  LevelDef,
  LevelTuning,
  Objective,
  ObjectiveType,
  StageDef,
  StarKind,
} from './challenge';
import { botPlay, qualifies, starsFromRun } from './solver';

/** Days since 1970-01-01 of a calendar date (proleptic Gregorian, no time zone involved). */
export function dayNumber(date: CalendarDate): number {
  // Howard Hinnant's days_from_civil.
  const y = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (date.month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + date.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of {@link dayNumber}. */
export function dateOfDay(day: number): CalendarDate {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { year: era * 400 + yoe + (m <= 2 ? 1 : 0), month: m, day: d };
}

/** `YYYY-MM-DD` of a day number. */
export function dayKey(day: number): string {
  const d = dateOfDay(day);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** The rule twists and start bonuses a day can carry (i18n `dailyMod_<id>`). */
export const DAILY_MODIFIERS = [
  'blast',
  'stock',
  'swift',
  'kick',
  'toss',
  'pierce',
  'shield',
  'treasure',
  'lean',
] as const;
export type DailyModifier = (typeof DAILY_MODIFIERS)[number];

interface ModifierEffect {
  readonly rules?: Partial<Rules>;
  readonly abilities?: number;
}

const MODIFIER_EFFECT: Readonly<Record<DailyModifier, ModifierEffect>> = {
  blast: { rules: { startRange: 4 } },
  stock: { rules: { startBombs: 3 } },
  swift: { rules: { startSpeedLevel: 2 } },
  kick: { abilities: Ability.KICK },
  toss: { abilities: Ability.TOSS },
  pierce: { abilities: Ability.PIERCE },
  shield: { abilities: Ability.SHIELD },
  treasure: { rules: { powerupChance: 60 } },
  lean: { rules: { powerupChance: 0, startBombs: 2 } },
};

/** Objectives a day can ask for, with how often they come up. */
type DailyObjective = Exclude<ObjectiveType, 'chain'>;
const OBJECTIVE_WEIGHTS: ReadonlyArray<readonly [DailyObjective, number]> = [
  ['crates', 3],
  ['monsters', 3],
  ['flag', 2],
  ['collect', 2],
  ['survive', 2],
  ['win', 2],
];

/** A duel round that must end (as in the campaign). */
const DUEL = { roundSeconds: 75, suddenDeath: 'spiral' } as const;

/** One generated daily challenge. */
export interface DailyDef {
  /** Day number ({@link dayNumber}). */
  readonly day: number;
  /** Re-roll index (0 unless an earlier candidate of the day was not winnable). */
  readonly roll: number;
  /** The free arena the variant is built on (its name is shown). */
  readonly baseArena: ArenaDef;
  readonly modifier: DailyModifier;
  /** A single-stage level, id `daily-YYYY-MM-DD`. */
  readonly level: LevelDef;
}

/** A daily challenge proven winnable: the definition plus its seed and star thresholds. */
export interface DailyChallenge extends DailyDef {
  readonly tuning: LevelTuning;
}

const LEVEL_ID_PREFIX = 'daily-';

export function isDailyLevel(level: Pick<LevelDef, 'id'>): boolean {
  return level.id.startsWith(LEVEL_ID_PREFIX);
}

function mixSeed(day: number, roll: number, salt: number): number {
  let h = Math.imul(day ^ 0x5bd1e995, 0x9e3779b1) ^ Math.imul(roll + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35) ^ salt;
  return (h ^ (h >>> 13)) | 0;
}

/** Plain floor cells (no spawn, no mechanic pad) at least `minDist` tiles from spawn 1. */
function openCells(arena: ArenaDef, minDist: number): number[] {
  const check = validateArena(arena);
  if (!check.parsed) throw new Error(`arena ${arena.id} is invalid`);
  const { cells, spawns, fx } = check.parsed;
  const start = spawns[0] as number;
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== LayoutCell.FLOOR || fx[i] !== 0 || i === start) continue;
    const d =
      Math.abs((i % GRID_W) - (start % GRID_W)) +
      Math.abs(Math.floor(i / GRID_W) - Math.floor(start / GRID_W));
    if (d >= minDist) out.push(i);
  }
  return out;
}

function pickCells(rng: Uint32Array, cells: number[], n: number): number[] {
  const pool = cells.slice();
  const out: number[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(randInt(rng, STREAM, pool.length), 1)[0] as number);
  }
  return out;
}

const STREAM = RngStream.ROUND;

/**
 * The candidate challenge of `day` (re-roll `roll`). Pure; not yet proven winnable – see
 * {@link prepareDaily}.
 */
export function dailyCandidate(day: number, roll = 0): DailyDef {
  const rng = createRngWords(mixSeed(day, roll, 0x0da11e));
  const pick = <T>(items: readonly T[]): T => items[randInt(rng, STREAM, items.length)] as T;
  const total = OBJECTIVE_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = randInt(rng, STREAM, total);
  let type: DailyObjective = 'crates';
  for (const [kind, w] of OBJECTIVE_WEIGHTS) {
    if (r < w) {
      type = kind;
      break;
    }
    r -= w;
  }
  const baseArena = pick(FREE_ARENAS);
  // Fewer crates where things have to move around; a denser field for crate hunts.
  const densities = type === 'crates' ? [45, 55, 65] : [40, 50, 60];
  const density = pick(densities);
  const key = dayKey(day);
  const arena = variant(baseArena, `daily-${baseArena.id}-${density}`, density);
  // `collect` and the pick-up star of `survive` need power-ups: no lean day for them.
  const needsLoot = type === 'collect' || type === 'survive';
  const modifiers = DAILY_MODIFIERS.filter((m) => !(needsLoot && m === 'lean'));
  const modifier = pick(modifiers);
  const effect = MODIFIER_EFFECT[modifier];

  let objective: Objective;
  let rules: Partial<Rules> = { ...effect.rules };
  let bots: number[] | undefined;
  let monsters: MonsterSpawn[] | undefined;
  let flag: { x: number; y: number } | undefined;
  let stars: readonly [StarKind, StarKind] = ['time', 'bombs'];
  const spawn = (cell: number, kind: number): MonsterSpawn => ({
    kind,
    x: cell % GRID_W,
    y: Math.floor(cell / GRID_W),
  });
  switch (type) {
    case 'crates':
      objective = { type, seconds: 90 + 10 * Math.floor(density / 10) };
      break;
    case 'monsters': {
      const count = 2 + randInt(rng, STREAM, 2);
      const kinds = [Monster.SNAIL, Monster.SNAIL, Monster.HOPPER, Monster.HOUND];
      monsters = pickCells(rng, openCells(arena, 6), count).map((c) => spawn(c, pick(kinds)));
      objective = { type, seconds: 100 + 10 * count };
      if (modifier === 'shield') stars = ['time', 'noDamage'];
      break;
    }
    case 'flag': {
      const [goal] = pickCells(rng, openCells(arena, 14), 1);
      const cell = goal ?? (pickCells(rng, openCells(arena, 8), 1)[0] as number);
      flag = { x: cell % GRID_W, y: Math.floor(cell / GRID_W) };
      if (randInt(rng, STREAM, 2) === 1) {
        monsters = pickCells(
          rng,
          openCells(arena, 6).filter((c) => c !== cell),
          1,
        ).map((c) => spawn(c, Monster.SNAIL));
      }
      objective = { type, seconds: 80 };
      break;
    }
    case 'collect':
      rules = { ...rules, powerupChance: Math.max(rules.powerupChance ?? 0, 60) };
      objective = { type, count: 3 + randInt(rng, STREAM, 2), seconds: 100 };
      break;
    case 'survive':
      bots = [BotLevel.EASY, pick([BotLevel.EASY, BotLevel.NORMAL])];
      objective = { type, seconds: 45 };
      stars = ['bombs', 'pickups'];
      break;
    case 'win':
      bots = pick([[BotLevel.NORMAL], [BotLevel.EASY, BotLevel.EASY]]);
      rules = { ...DUEL, ...rules };
      objective = { type };
      break;
  }
  const stage: StageDef = {
    arena,
    objective,
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
    ...(bots ? { bots } : {}),
    ...(monsters && monsters.length > 0 ? { monsters } : {}),
    ...(flag ? { flag } : {}),
    ...(effect.abilities ? { startAbilities: effect.abilities } : {}),
  };
  return {
    day,
    roll,
    baseArena,
    modifier,
    level: {
      id: `${LEVEL_ID_PREFIX}${key}`,
      world: 0,
      index: 0,
      nameKey: 'dailyTitle',
      stages: [stage],
      stars,
    },
  };
}

/** Seeds tried per candidate, and candidates tried per day, before giving up. */
export const DAILY_SEED_TRIES = 6;
export const DAILY_ROLLS = 8;

/** Match seed of attempt `attempt` of a candidate. */
export function dailySeed(day: number, roll: number, attempt: number): number {
  return mixSeed(day, roll, attempt + 1);
}

/**
 * Proves `def` winnable with the seed of `attempt` (the bot wins with room to spare) and returns
 * the playable challenge, or null.
 */
export function tryDailySeed(def: DailyDef, attempt: number): DailyChallenge | null {
  const seed = dailySeed(def.day, def.roll, attempt);
  const run = botPlay(def.level, 0, seed);
  if (!qualifies(def.level, 0, run)) return null;
  return { ...def, tuning: { seeds: [seed], stars: starsFromRun(def.level, run.stats) } };
}

/** Where a prepared day was found (to skip the search next time; see `DailyStore`). */
export interface DailyPick {
  readonly roll: number;
  readonly attempt: number;
}

/** Rebuilds a prepared challenge from a remembered pick (null if it no longer qualifies). */
export function dailyFromPick(day: number, pick: DailyPick): DailyChallenge | null {
  return tryDailySeed(dailyCandidate(day, pick.roll), pick.attempt);
}

/**
 * The daily challenge of `day`: the first candidate and seed the Expert bot wins with room to
 * spare. Deterministic; a few hundred milliseconds of simulation in the usual case.
 */
export function prepareDaily(day: number): { challenge: DailyChallenge; pick: DailyPick } {
  for (let roll = 0; roll < DAILY_ROLLS; roll++) {
    const def = dailyCandidate(day, roll);
    for (let attempt = 0; attempt < DAILY_SEED_TRIES; attempt++) {
      const challenge = tryDailySeed(def, attempt);
      if (challenge) return { challenge, pick: { roll, attempt } };
    }
  }
  throw new Error(`no winnable daily challenge for ${dayKey(day)}`);
}

/** Lets the UI breathe between bot runs (each one is a few hundred milliseconds at most). */
const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * {@link prepareDaily} without blocking the page for the whole search: yields between seed tries,
 * and starts from a remembered pick when one is known (falling back to the full search when it no
 * longer qualifies, e.g. after a simulation change).
 */
export async function prepareDailyAsync(
  day: number,
  known: DailyPick | null,
  pause: () => Promise<void> = nextMacrotask,
): Promise<{ challenge: DailyChallenge; pick: DailyPick }> {
  if (known) {
    const challenge = dailyFromPick(day, known);
    if (challenge) return { challenge, pick: known };
  }
  for (let roll = 0; roll < DAILY_ROLLS; roll++) {
    const def = dailyCandidate(day, roll);
    for (let attempt = 0; attempt < DAILY_SEED_TRIES; attempt++) {
      await pause();
      const challenge = tryDailySeed(def, attempt);
      if (challenge) return { challenge, pick: { roll, attempt } };
    }
  }
  throw new Error(`no winnable daily challenge for ${dayKey(day)}`);
}
