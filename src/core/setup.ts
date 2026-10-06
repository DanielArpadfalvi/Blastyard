/**
 * Builds the initial simulation state for a round from a seed, an arena and the seat setup.
 *
 * Spawn assignment: 4 players → spawns 1–4 in seat order; 2 players → spawn 1 and the spawn
 * farthest from it (diagonal corners); 3 players → one spawn left out, chosen by the ROUND stream;
 * 1 player → spawn 1. Active seats take the chosen spawns in ascending order. The crate / pickup
 * layout depends only on the seed and the arena, never on the seat setup.
 */

import {
  DEFAULT_CRATE_DENSITY,
  DEFAULT_POWERUP_CHANCE,
  DEFAULT_POWERUP_WEIGHTS,
  SPAWN_COUNT,
  fillArena,
  loadArena,
  type ArenaDef,
  type ParsedArena,
} from './arena';
import { Dir } from './input';
import { RngStream, randInt, seedAllStreams } from './rng';
import {
  GRID_W,
  Hdr,
  MAX_SEATS,
  Phase,
  createEmptyState,
  tileCenter,
  type SimState,
} from './state';

/** Player-related rules that the core needs at setup (extended by the round / match rules). */
export interface CoreRules {
  readonly startBombs: number;
  readonly startRange: number;
  readonly startSpeedLevel: number;
  /** Percent chance that a crate hides a power-up. */
  readonly powerupChance: number;
  /** Weights per `Pickup` kind − 1 (length 9); an arena's own weights take precedence. */
  readonly powerupWeights: readonly number[];
}

export const DEFAULT_RULES: CoreRules = {
  startBombs: 1,
  startRange: 2,
  startSpeedLevel: 0,
  powerupChance: DEFAULT_POWERUP_CHANCE,
  powerupWeights: DEFAULT_POWERUP_WEIGHTS,
};

export const MAX_BOMB_CAPACITY = 6;
export const MAX_RANGE = 7;

export interface MatchSetup {
  /** 32-bit integer seed. */
  readonly seed: number;
  readonly arena: ArenaDef;
  /** Which seats (0–3) take part; at least one. */
  readonly seats: readonly boolean[];
  /** Optional team per seat (2v2); defaults to the seat index (free-for-all). */
  readonly teams?: readonly number[];
  readonly rules?: Partial<CoreRules>;
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

/** Creates a ready-to-step state (phase PLAYING, tick 0). Throws on an invalid arena or setup. */
export function createState(setup: MatchSetup): SimState {
  if (!Number.isInteger(setup.seed)) throw new RangeError('seed must be an integer');
  const rules: CoreRules = { ...DEFAULT_RULES, ...setup.rules };
  const parsed = loadArena(setup.arena);
  const state = createEmptyState();
  const seed = setup.seed >>> 0;
  state.hdr[Hdr.SEED] = seed | 0;
  state.hdr[Hdr.PHASE] = Phase.PLAYING;
  seedAllStreams(state.rng, seed);

  fillArena(state, parsed, {
    crateDensity: setup.arena.crateDensity ?? DEFAULT_CRATE_DENSITY,
    powerupChance: clampInt(rules.powerupChance, 0, 100, 'powerupChance'),
    powerupWeights: setup.arena.powerupWeights ?? rules.powerupWeights,
  });

  const seats: number[] = [];
  for (let s = 0; s < MAX_SEATS; s++) if (setup.seats[s]) seats.push(s);
  if (seats.length === 0) throw new RangeError('at least one seat must be active');
  const spawns = chooseSpawns(state, parsed, seats.length);

  let mask = 0;
  seats.forEach((seat, k) => {
    const cell = parsed.spawns[spawns[k] as number] as number;
    const x = cell % GRID_W;
    mask |= 1 << seat;
    state.px[seat] = tileCenter(x);
    state.py[seat] = tileCenter((cell - x) / GRID_W);
    state.alive[seat] = 1;
    state.facing[seat] = Dir.DOWN;
    state.moveDir[seat] = Dir.NONE;
    state.bombCap[seat] = clampInt(rules.startBombs, 1, MAX_BOMB_CAPACITY, 'startBombs');
    state.range[seat] = clampInt(rules.startRange, 1, MAX_RANGE, 'startRange');
    state.speedLvl[seat] = clampInt(rules.startSpeedLevel, 0, 4, 'startSpeedLevel');
    state.team[seat] = setup.teams?.[seat] ?? seat;
  });
  state.hdr[Hdr.SEAT_MASK] = mask;
  return state;
}
