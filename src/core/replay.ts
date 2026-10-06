/**
 * Input logs and replays (PLAN §3.1).
 *
 * Each tick's four seat bytes pack into one uint32 (`packInputs`). A log is run-length encoded as
 * a flat, JSON-friendly number array `[packed, count, packed, count, …]` – held directions and idle
 * seats compress to a handful of runs. A replay is the match setup (seed, arena id, seats, teams,
 * rules) plus the log and `SIM_VERSION`; running it through `step` reproduces the match bit for
 * bit, which `finalHash` (hex) can verify.
 */

import type { ArenaDef } from './arena';
import type { SimEvent } from './events';
import { hashHex } from './hash';
import { unpackInputs } from './input';
import { createState, type MatchSetup } from './setup';
import { stateHash, type SimState } from './state';
import { step } from './step';
import { SIM_VERSION } from './version';

/** Run-length encoded input log: `[packed, count, packed, count, …]`, counts ≥ 1. */
export type InputRLE = number[];

/** Appends one tick's packed inputs to an RLE log (extends the last run when equal). */
export function appendInputs(log: InputRLE, packed: number): void {
  const value = packed >>> 0;
  const n = log.length;
  if (n >= 2 && log[n - 2] === value) {
    log[n - 1] = (log[n - 1] as number) + 1;
  } else {
    log.push(value, 1);
  }
}

/** Encodes one packed value per tick. */
export function rleEncode(ticks: ArrayLike<number>): InputRLE {
  const log: InputRLE = [];
  for (let i = 0; i < ticks.length; i++) appendInputs(log, ticks[i] as number);
  return log;
}

function checkRuns(log: InputRLE): void {
  if (log.length % 2 !== 0) throw new RangeError('input log: odd length');
  for (let i = 0; i < log.length; i += 2) {
    const value = log[i] as number;
    const count = log[i + 1] as number;
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError(`input log: bad value at run ${i / 2}`);
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(`input log: bad count at run ${i / 2}`);
    }
  }
}

/** Number of ticks in a log. */
export function rleLength(log: InputRLE): number {
  checkRuns(log);
  let total = 0;
  for (let i = 1; i < log.length; i += 2) total += log[i] as number;
  return total;
}

/** Expands a log to one packed value per tick. */
export function rleDecode(log: InputRLE): Uint32Array {
  const out = new Uint32Array(rleLength(log));
  let k = 0;
  for (let i = 0; i < log.length; i += 2) {
    out.fill(log[i] as number, k, k + (log[i + 1] as number));
    k += log[i + 1] as number;
  }
  return out;
}

/** Calls `fn(packed)` once per tick of the log without expanding it. */
export function forEachTick(log: InputRLE, fn: (packed: number) => void): void {
  checkRuns(log);
  for (let i = 0; i < log.length; i += 2) {
    const value = log[i] as number;
    const count = log[i + 1] as number;
    for (let c = 0; c < count; c++) fn(value);
  }
}

export interface Replay extends Omit<MatchSetup, 'arena'> {
  readonly simVersion: number;
  readonly arenaId: string;
  readonly inputs: InputRLE;
  /** `hashHex(stateHash)` after the last tick, when known. */
  readonly finalHash?: string;
}

export interface ReplayResult {
  readonly state: SimState;
  readonly ticks: number;
  /** `hashHex` of the final state. */
  readonly hash: string;
  /** False only when the replay carries a `finalHash` that differs. */
  readonly hashMatches: boolean;
}

/** Records a match: wraps `step`, appending every tick's inputs to the log. */
export class ReplayRecorder {
  readonly inputs: InputRLE = [];
  private readonly scratch = new Uint8Array(4);

  constructor(
    readonly setup: MatchSetup,
    readonly state: SimState = createState(setup),
  ) {}

  /** Steps the recorded state with `inputs` (4 seat bytes) and logs them. */
  step(inputs: ArrayLike<number>): readonly SimEvent[] {
    let packed = 0;
    for (let s = 0; s < 4; s++) packed |= ((inputs[s] ?? 0) & 0xff) << (s * 8);
    appendInputs(this.inputs, packed >>> 0);
    unpackInputs(packed >>> 0, this.scratch);
    return step(this.state, this.scratch);
  }

  /** The replay of everything recorded so far. */
  toReplay(): Replay {
    const { arena, ...rest } = this.setup;
    return {
      ...rest,
      simVersion: SIM_VERSION,
      arenaId: arena.id,
      inputs: this.inputs.slice(),
      finalHash: hashHex(stateHash(this.state)),
    };
  }
}

/**
 * Re-runs a replay from scratch. `arena` must be the definition with id `replay.arenaId`.
 * Throws when the replay was recorded with another `SIM_VERSION`.
 */
export function runReplay(
  replay: Replay,
  arena: ArenaDef,
  onTick?: (state: SimState, tick: number) => void,
): ReplayResult {
  if (replay.simVersion !== SIM_VERSION) {
    throw new RangeError(`replay is SIM_VERSION ${replay.simVersion}, expected ${SIM_VERSION}`);
  }
  if (arena.id !== replay.arenaId) {
    throw new RangeError(`replay needs arena '${replay.arenaId}', got '${arena.id}'`);
  }
  const setup: MatchSetup = {
    seed: replay.seed,
    arena,
    seats: replay.seats,
    ...(replay.teams ? { teams: replay.teams } : {}),
    ...(replay.rules ? { rules: replay.rules } : {}),
  };
  const state = createState(setup);
  const { inputs, finalHash } = replay;
  const seats = new Uint8Array(4);
  let ticks = 0;
  forEachTick(inputs, (packed) => {
    step(state, unpackInputs(packed, seats));
    ticks++;
    onTick?.(state, ticks);
  });
  const hash = hashHex(stateHash(state));
  return { state, ticks, hash, hashMatches: finalHash === undefined || finalHash === hash };
}
