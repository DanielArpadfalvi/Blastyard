/**
 * Builds the initial simulation state for a match from a seed, an arena, the seat setup and the
 * rules, then starts round 1 (countdown).
 *
 * Spawn assignment: 4 players → spawns 1–4 in seat order; 2 players → spawn 1 and the spawn
 * farthest from it (diagonal corners); 3 players → one spawn left out, chosen by the ROUND stream;
 * 1 player → spawn 1. Active seats take the chosen spawns in ascending order and keep them for the
 * whole match. The crate / pickup layout depends only on the seed, the arena and the rules, never
 * on the seat setup.
 */

import {
  DEFAULT_CRATE_DENSITY,
  SPAWN_COUNT,
  loadArena,
  type ArenaDef,
  type ParsedArena,
} from './arena';
import { setBotLevel } from './ai/difficulty';
import { MAX_BOMB_CAPACITY, MAX_RANGE } from './powerups';
import { startRound } from './match';
import { placeMonsters, type MonsterSpawn } from './monsters';
import { MAX_SPEED_LEVEL } from './movement';
import { RngStream, randInt, seedAllStreams } from './rng';
import { DEFAULT_RULES, type Rules } from './rules';
import {
  Ability,
  GRID_W,
  Hdr,
  MAX_SEATS,
  Phase,
  PICKUP_KIND_COUNT,
  RuleFlag,
  createEmptyState,
  type SimState,
} from './state';

export interface MatchSetup {
  /** 32-bit integer seed. */
  readonly seed: number;
  readonly arena: ArenaDef;
  /** Which seats (0–3) take part; at least one. */
  readonly seats: readonly boolean[];
  /**
   * Team per seat (0–3) for team mode (e.g. 2v2: `[0, 1, 0, 1]`). Omitted = free-for-all, every
   * seat is its own side.
   */
  readonly teams?: readonly number[];
  /**
   * Bot level per seat (`BotLevel`: 0 = human, 1 easy … 4 expert). Bots run inside `step` and
   * replace whatever input that seat is given; omitted = every seat is a human.
   */
  readonly bots?: readonly number[];
  /** Overrides on top of `DEFAULT_RULES` (Classic). */
  readonly rules?: Partial<Rules>;
  /** Challenge monsters (at most `MAX_MONSTERS`), standing on plain floor cells of the arena. */
  readonly monsters?: readonly MonsterSpawn[];
  /** Challenge flag: cell index of the goal tile (a floor cell), exposed to bots and the view. */
  readonly goalCell?: number;
  /** `Ability` bits every seat starts each round with (Kick and Toss exclude each other). */
  readonly startAbilities?: number;
  /**
   * Warm-up sandbox (party lobby): the round is already playing, has no clock, and flames and
   * monsters hurt nobody. Nobody wins; the match never ends.
   */
  readonly warmup?: boolean;
}

function manhattan(a: number, b: number): number {
  const ax = a % GRID_W;
  const bx = b % GRID_W;
  return Math.abs(ax - bx) + Math.abs((a - ax) / GRID_W - (b - bx) / GRID_W);
}

/** Spawn numbers (0-based) used for `count` players, ascending. */
export function chooseSpawns(state: SimState, parsed: ParsedArena, count: number): number[] {
  const all = [0, 1, 2, 3];
  if (count >= SPAWN_COUNT) return all;
  if (count === 1) return [0];
  if (count === 2) {
    const first = parsed.spawns[0] as number;
    let best = 1;
    for (let n = 2; n < SPAWN_COUNT; n++) {
      if (
        manhattan(first, parsed.spawns[n] as number) >
        manhattan(first, parsed.spawns[best] as number)
      ) {
        best = n;
      }
    }
    return [0, best];
  }
  const skip = randInt(state.rng, RngStream.ROUND, SPAWN_COUNT);
  return all.filter((n) => n !== skip);
}

function clampInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer`);
  return Math.min(max, Math.max(min, value));
}

/** Creates a match state in round 1's countdown (tick 0). Throws on an invalid arena or setup. */
export function createState(setup: MatchSetup): SimState {
  if (!Number.isInteger(setup.seed)) throw new RangeError('seed must be an integer');
  const rules: Rules = { ...DEFAULT_RULES, ...setup.rules };
  const parsed = loadArena(setup.arena);
  const state = createEmptyState();
  const hdr = state.hdr;
  const seed = setup.seed >>> 0;
  hdr[Hdr.SEED] = seed | 0;
  seedAllStreams(state.rng, seed);

  const weights = setup.arena.powerupWeights ?? rules.powerupWeights;
  if (weights.length !== PICKUP_KIND_COUNT || weights.some((w) => w > 0xffff)) {
    throw new RangeError('powerupWeights: 9 integers in 0–65535');
  }
  state.weights.set(weights);
  state.layout.set(parsed.cells);
  state.floor.set(parsed.fx);
  state.partner.set(parsed.partner);
  hdr[Hdr.MECH] = parsed.mech;

  let flags = 0;
  if (rules.suddenDeath === 'spiral' && !setup.warmup) flags |= RuleFlag.SUDDEN_DEATH;
  if (setup.warmup) flags |= RuleFlag.HARMLESS;
  if (rules.ghosts) flags |= RuleFlag.GHOSTS;
  if (rules.friendlyFire) flags |= RuleFlag.FRIENDLY_FIRE;
  if (rules.selfDamage === false) flags |= RuleFlag.NO_SELF_DAMAGE;
  if (rules.cornerAssist === 'low') flags |= RuleFlag.ASSIST_LOW;
  if (rules.cornerAssist === 'high') flags |= RuleFlag.ASSIST_HIGH;
  if (setup.teams) flags |= RuleFlag.TEAMS;
  hdr[Hdr.RULE_FLAGS] = flags;
  hdr[Hdr.ROUND_TICKS] = setup.warmup
    ? 0
    : clampInt(rules.roundSeconds, 0, 3600, 'roundSeconds') * 60;
  hdr[Hdr.WINS_TO_MATCH] = clampInt(rules.winsToMatch, 1, 9, 'winsToMatch');
  hdr[Hdr.START_BOMBS] = clampInt(rules.startBombs, 1, MAX_BOMB_CAPACITY, 'startBombs');
  hdr[Hdr.START_RANGE] = clampInt(rules.startRange, 1, MAX_RANGE, 'startRange');
  hdr[Hdr.START_SPEED] = clampInt(rules.startSpeedLevel, 0, MAX_SPEED_LEVEL, 'startSpeedLevel');
  hdr[Hdr.POWERUP_CHANCE] = clampInt(rules.powerupChance, 0, 100, 'powerupChance');
  hdr[Hdr.CRATE_DENSITY] = setup.arena.crateDensity ?? DEFAULT_CRATE_DENSITY;

  const abilities = setup.startAbilities ?? 0;
  if (!Number.isInteger(abilities) || abilities < 0 || abilities > 15) {
    throw new RangeError('startAbilities: bits 0–15');
  }
  if ((abilities & Ability.KICK) !== 0 && (abilities & Ability.TOSS) !== 0) {
    throw new RangeError('startAbilities: Kick and Toss are mutually exclusive');
  }
  hdr[Hdr.START_ABILITIES] = abilities;
  if (setup.goalCell !== undefined) {
    const goal = setup.goalCell;
    if (!Number.isInteger(goal) || goal <= 0 || goal >= state.layout.length) {
      throw new RangeError('goalCell must be a cell index');
    }
    if (parsed.cells[goal] !== 0) throw new RangeError('goalCell must be a plain floor cell');
    hdr[Hdr.GOAL_CELL] = goal;
  }

  const seats: number[] = [];
  for (let s = 0; s < MAX_SEATS; s++) if (setup.seats[s]) seats.push(s);
  if (seats.length === 0) throw new RangeError('at least one seat must be active');
  const spawns = chooseSpawns(state, parsed, seats.length);

  let mask = 0;
  seats.forEach((seat, k) => {
    mask |= 1 << seat;
    state.spawnCell[seat] = parsed.spawns[spawns[k] as number] as number;
    const team = setup.teams?.[seat] ?? seat;
    if (!Number.isInteger(team) || team < 0 || team >= MAX_SEATS) {
      throw new RangeError('teams must be integers 0–3');
    }
    state.team[seat] = team;
  });
  hdr[Hdr.SEAT_MASK] = mask;
  for (const seat of seats) setBotLevel(state, seat, setup.bots?.[seat] ?? 0);
  startRound(state);
  if (setup.monsters) {
    for (const m of setup.monsters) {
      if (parsed.cells[m.y * GRID_W + m.x] !== 0) {
        throw new RangeError('monsters must start on plain floor cells');
      }
    }
    placeMonsters(state, setup.monsters);
  }
  if (setup.warmup) {
    hdr[Hdr.PHASE] = Phase.PLAYING;
    hdr[Hdr.PHASE_TIMER] = 0;
  }
  return state;
}
