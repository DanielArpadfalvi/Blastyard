/**
 * Challenge campaign model and objective logic (T5.2, PLAN §1.7).
 *
 * A level is one or more *stages* (a world gauntlet has three); each stage is an ordinary match
 * state – one human seat plus optional bots, monsters, a flag – with an objective:
 *
 * - `crates`: destroy every crate within `seconds`
 * - `monsters`: defeat every monster (optionally within `seconds`)
 * - `flag`: walk onto the flag tile (optionally within `seconds`)
 * - `survive`: stay alive for `seconds` (or beat the bots sooner)
 * - `win`: be the last one standing against the bots
 * - `collect`: pick up `count` power-ups within `seconds`
 *
 * The {@link ChallengeTracker} watches a running state (and its events) and decides when a stage
 * is won or lost; it is pure, so the game session and the headless content validator
 * (`scripts/validate-content.ts`, which replays every reference solution) share it. Stars: 1 =
 * the objective is done, then one star for each of two extra conditions of the level (a time,
 * a bomb budget, no damage taken, a number of power-ups – see {@link StarCond}).
 */

import {
  BotLevel,
  EventKind,
  GRID_W,
  Hdr,
  MAX_SEATS,
  Tile,
  createState,
  hashHex,
  monstersAlive,
  playerCell,
  rleDecode,
  stateHash,
  step,
  type ArenaDef,
  type InputRLE,
  type MatchSetup,
  type MonsterSpawn,
  type Rules,
  type SimEvent,
  type SimState,
} from '../core';

export type ObjectiveType = 'crates' | 'monsters' | 'flag' | 'survive' | 'win' | 'collect';

export interface Objective {
  readonly type: ObjectiveType;
  /** Time limit in seconds (`survive`: how long to stay alive). */
  readonly seconds?: number;
  /** `collect`: power-ups to pick up. */
  readonly count?: number;
}

export interface StageDef {
  readonly arena: ArenaDef;
  /** Rule overrides on top of the challenge defaults (no clock, no sudden death, no ghosts). */
  readonly rules?: Partial<Rules>;
  /** Bot difficulties (`BotLevel`), one per opponent seat (seats 1…). */
  readonly bots?: readonly number[];
  readonly monsters?: readonly MonsterSpawn[];
  /** The flag tile (`flag` objective). */
  readonly flag?: { readonly x: number; readonly y: number };
  /** `Ability` bits the player starts with. */
  readonly startAbilities?: number;
  readonly objective: Objective;
}

/** The two optional star conditions of a level. */
export type StarKind = 'time' | 'bombs' | 'noDamage' | 'pickups';

export type StarCond =
  | { readonly kind: 'time'; readonly seconds: number }
  | { readonly kind: 'bombs'; readonly max: number }
  | { readonly kind: 'noDamage' }
  | { readonly kind: 'pickups'; readonly min: number };

export interface LevelDef {
  /** `w<world>-<nn>`, e.g. `w1-04`. */
  readonly id: string;
  /** 1–3. */
  readonly world: number;
  /** 1–12 inside the world; 12 is the gauntlet. */
  readonly index: number;
  /** i18n key of the level name. */
  readonly nameKey: string;
  readonly stages: readonly StageDef[];
  /** Which extra conditions give stars 2 and 3 (the numbers come from the tuning). */
  readonly stars: readonly [StarKind, StarKind];
}

/** Numbers the authoring script derives from the reference solution (seeds, star thresholds). */
export interface LevelTuning {
  /** Match seed per stage. */
  readonly seeds: readonly number[];
  readonly stars: readonly [StarCond, StarCond];
}

/** A level's reference solution: the player's input byte per tick, per stage, and proof hashes. */
export interface LevelSolution {
  /** RLE of the packed input bytes (seat 0 in the low byte) per stage. */
  readonly logs: readonly InputRLE[];
  /** State hash (hex) at the tick each stage was won. */
  readonly hashes: readonly string[];
}

export const PLAYER_SEAT = 0;

/** What a (partial) run measured; the star conditions are evaluated on it. */
export interface RunStats {
  /** Playing ticks (countdown excluded), summed over the stages. */
  readonly ticks: number;
  /** Bombs the player placed. */
  readonly bombs: number;
  readonly pickups: number;
  /** Times the player's Shield took a hit. */
  readonly damage: number;
  readonly kills: number;
}

const ZERO_STATS: RunStats = { ticks: 0, bombs: 0, pickups: 0, damage: 0, kills: 0 };

function addStats(a: RunStats, b: RunStats): RunStats {
  return {
    ticks: a.ticks + b.ticks,
    bombs: a.bombs + b.bombs,
    pickups: a.pickups + b.pickups,
    damage: a.damage + b.damage,
    kills: a.kills + b.kills,
  };
}

/** Is star condition `cond` met by a *won* run? */
export function condMet(cond: StarCond, stats: RunStats): boolean {
  switch (cond.kind) {
    case 'time':
      return stats.ticks <= cond.seconds * 60;
    case 'bombs':
      return stats.bombs <= cond.max;
    case 'noDamage':
      return stats.damage === 0;
    case 'pickups':
      return stats.pickups >= cond.min;
  }
}

/** Stars of a won run: 1 plus one per met extra condition (0 for a lost run). */
export function starsFor(won: boolean, stats: RunStats, conds: readonly StarCond[]): number {
  if (!won) return 0;
  return 1 + conds.filter((c) => condMet(c, stats)).length;
}

/** The core setup of stage `index` of `level` with `seed`. */
export function stageSetup(level: LevelDef, index: number, seed: number): MatchSetup {
  const stage = level.stages[index];
  if (!stage) throw new RangeError(`level ${level.id} has no stage ${index}`);
  const opponents = stage.bots ?? [];
  if (opponents.length > MAX_SEATS - 1) throw new RangeError('at most three bots');
  const seats = [true, ...opponents.map(() => true)];
  while (seats.length < MAX_SEATS) seats.push(false);
  const bots = [BotLevel.NONE, ...opponents];
  while (bots.length < MAX_SEATS) bots.push(BotLevel.NONE);
  return {
    seed,
    arena: stage.arena,
    seats,
    bots,
    rules: {
      roundSeconds: 0,
      suddenDeath: 'none',
      ghosts: false,
      winsToMatch: 1,
      ...stage.rules,
    },
    ...(stage.monsters ? { monsters: stage.monsters } : {}),
    ...(stage.flag ? { goalCell: stage.flag.y * GRID_W + stage.flag.x } : {}),
    ...(stage.startAbilities ? { startAbilities: stage.startAbilities } : {}),
  };
}

export type RunStatus = 'running' | 'won' | 'lost';
export type LossReason = 'died' | 'time' | 'round';

/** Objective progress for the HUD. */
export interface ObjectiveProgress {
  readonly type: ObjectiveType;
  /** Done so far / needed (crates: broken / total, monsters: defeated / total …). */
  readonly done: number;
  readonly target: number;
  /** Seconds left on the clock, or `null` without a time limit. */
  readonly secondsLeft: number | null;
  readonly stage: number;
  readonly stages: number;
}

export class ChallengeTracker {
  private stageIndex = 0;
  private current: RunStats = ZERO_STATS;
  private finished: RunStats = ZERO_STATS;
  private startTick = -1;
  private cratesAtStart = -1;
  private monstersAtStart = 0;
  private state: RunStatus = 'running';
  private stageDone = false;
  private reason: LossReason | null = null;
  private lastTicks = 0;

  constructor(readonly level: LevelDef) {}

  get stage(): number {
    return this.stageIndex;
  }

  get status(): RunStatus {
    return this.state;
  }

  /** True between the moment a non-final stage is won and the call of {@link advance}. */
  get stageWon(): boolean {
    return this.stageDone;
  }

  get lossReason(): LossReason | null {
    return this.reason;
  }

  get stageDef(): StageDef {
    return this.level.stages[this.stageIndex] as StageDef;
  }

  /** Stats of the whole run so far (finished stages plus the running one). */
  totals(): RunStats {
    return addStats(this.finished, this.current);
  }

  /** Moves on to the next stage after {@link stageWon}. */
  advance(): void {
    this.finished = addStats(this.finished, this.current);
    this.current = ZERO_STATS;
    this.stageIndex++;
    this.stageDone = false;
    this.startTick = -1;
    this.cratesAtStart = -1;
  }

  /** Playing ticks of the running stage. */
  private elapsed(state: SimState): number {
    return this.startTick < 0 ? 0 : (state.hdr[Hdr.TICK] as number) - this.startTick;
  }

  /** Called once per simulated tick with the state after it and that tick's events. */
  observe(state: SimState, events: readonly SimEvent[]): void {
    if (this.state !== 'running' || this.stageDone) return;
    let { bombs, pickups, damage, kills } = this.current;
    let roundWinner: number | undefined;
    for (const e of events) {
      switch (e.kind) {
        case EventKind.ROUND_START:
          this.startTick = e.tick;
          break;
        case EventKind.BOMB_PLACED:
          if (e.seat === PLAYER_SEAT) bombs++;
          break;
        case EventKind.PICKUP_COLLECTED:
          if (e.seat === PLAYER_SEAT) pickups++;
          break;
        case EventKind.SHIELD_BROKEN:
          if (e.seat === PLAYER_SEAT) damage++;
          break;
        case EventKind.MONSTER_KILLED:
          kills++;
          break;
        case EventKind.ROUND_END:
          roundWinner = e.value;
          break;
        default:
          break;
      }
    }
    const ticks = this.elapsed(state);
    this.current = { ticks, bombs, pickups, damage, kills };
    this.lastTicks = ticks;
    if (this.cratesAtStart < 0) {
      this.cratesAtStart = countCrates(state);
      this.monstersAtStart = monstersAlive(state) + kills;
    }

    const objective = this.stageDef.objective;
    const limit = objective.seconds !== undefined ? objective.seconds * 60 : Infinity;
    if (!state.alive[PLAYER_SEAT]) return this.lose('died');
    if (roundWinner !== undefined && roundWinner !== PLAYER_SEAT) return this.lose('round');
    let met = false;
    switch (objective.type) {
      case 'crates':
        met = countCrates(state) === 0;
        break;
      case 'monsters':
        met = monstersAlive(state) === 0;
        break;
      case 'flag':
        met = playerCell(state, PLAYER_SEAT) === (state.hdr[Hdr.GOAL_CELL] as number);
        break;
      case 'survive':
        met = ticks >= limit || roundWinner === PLAYER_SEAT;
        break;
      case 'win':
        met = roundWinner === PLAYER_SEAT;
        break;
      case 'collect':
        met = pickups >= (objective.count ?? 1);
        break;
    }
    if (met) {
      if (this.stageIndex >= this.level.stages.length - 1) this.state = 'won';
      else this.stageDone = true;
      return;
    }
    if (objective.type !== 'survive' && ticks >= limit) this.lose('time');
  }

  private lose(reason: LossReason): void {
    this.state = 'lost';
    this.reason = reason;
  }

  /** HUD numbers for the running stage. */
  progress(state: SimState): ObjectiveProgress {
    const objective = this.stageDef.objective;
    const ticks = this.startTick < 0 ? 0 : this.elapsed(state);
    const secondsLeft =
      objective.seconds === undefined
        ? null
        : Math.max(0, Math.ceil(objective.seconds - ticks / 60));
    let done: number;
    let target = 1;
    switch (objective.type) {
      case 'crates': {
        const total = Math.max(this.cratesAtStart, countCrates(state));
        target = total;
        done = total - countCrates(state);
        break;
      }
      case 'monsters':
        target = Math.max(1, this.monstersAtStart || monstersAlive(state));
        done = target - monstersAlive(state);
        break;
      case 'collect':
        target = objective.count ?? 1;
        done = Math.min(target, this.current.pickups);
        break;
      default:
        done = this.stageDone || this.state === 'won' ? 1 : 0;
        break;
    }
    return {
      type: objective.type,
      done,
      target,
      secondsLeft,
      stage: this.stageIndex + 1,
      stages: this.level.stages.length,
    };
  }

  /** Playing ticks of the running stage as of the last observation. */
  get stageTicks(): number {
    return this.lastTicks;
  }
}

export function countCrates(state: SimState): number {
  let n = 0;
  for (let i = 0; i < state.tiles.length; i++) if (state.tiles[i] === Tile.CRATE) n++;
  return n;
}

export interface ReplayOutcome {
  readonly status: RunStatus;
  readonly lossReason: LossReason | null;
  readonly stats: RunStats;
  /** Stages won. */
  readonly stagesWon: number;
  /** State hash (hex) at the tick each won stage ended. */
  readonly hashes: readonly string[];
  /** Ticks used per stage log until its stage was won (the whole log when it never was). */
  readonly ticks: readonly number[];
}

/**
 * Plays a level headless from the player's input logs (one per stage; bots and monsters run
 * inside the simulation) and reports the outcome. Used by the validator, the authoring script
 * and the tests.
 */
export function replayLevel(
  level: LevelDef,
  seeds: readonly number[],
  logs: readonly InputRLE[],
): ReplayOutcome {
  const tracker = new ChallengeTracker(level);
  const hashes: string[] = [];
  const ticksUsed: number[] = [];
  const inputs = new Uint8Array(MAX_SEATS);
  let stagesWon = 0;
  for (let k = 0; k < level.stages.length && tracker.status === 'running'; k++) {
    const state = createState(stageSetup(level, k, seeds[k] ?? 0));
    const log = rleDecode(logs[k] ?? []);
    let used = 0;
    for (let t = 0; t < log.length; t++) {
      inputs[PLAYER_SEAT] = (log[t] as number) & 0xff;
      const events = step(state, inputs);
      used++;
      tracker.observe(state, events);
      if (tracker.status !== 'running' || tracker.stageWon) break;
    }
    ticksUsed.push(used);
    const status = tracker.status as RunStatus;
    if (status === 'running' && !tracker.stageWon) break;
    if (status === 'lost') break;
    stagesWon++;
    hashes.push(hashHex(stateHash(state)));
    if (tracker.status === 'running') tracker.advance();
  }
  return {
    status: tracker.status,
    lossReason: tracker.lossReason,
    stats: tracker.totals(),
    stagesWon,
    hashes,
    ticks: ticksUsed,
  };
}
