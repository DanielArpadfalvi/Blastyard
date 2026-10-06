/**
 * Simulation benchmark (T1.6, PLAN §3.2): plays seeded 4-player rounds (Classic rules, the four
 * classic arenas in turn) headless with scripted inputs and measures the mean `step` time and the mean snapshot + restore time.
 *
 * Budgets are for a mid-range phone (step ≤ 0.1 ms, snapshot + restore ≤ 0.05 ms). On a desktop /
 * CI runner the measured values must stay below budget ÷ `SAFETY_MARGIN` (3×), which leaves room
 * for slower devices. Also fails on any exception, non-integer state value or a round that does
 * not end.
 *
 * Usage: `npm run sim:bench [-- --rounds 1000 --seed 1]`
 */

import { CLASSIC_ARENAS } from '../src/content/arenas/classic';
import {
  GRID_H,
  GRID_W,
  Hdr,
  Phase,
  STATE_BYTES,
  TILE,
  createState,
  restore,
  snapshotInto,
  step,
  type SimState,
} from '../src/core';
import { ScriptedInputs } from './scripted-inputs';

export const STEP_BUDGET_MS = 0.1;
export const SNAPSHOT_BUDGET_MS = 0.05;
export const SAFETY_MARGIN = 3;
/** A round can never take longer: countdown + 120 s + full spiral incl. pause, plus slack. */
export const MAX_ROUND_TICKS = 12_000;
const SNAPSHOT_EVERY = 120;
/**
 * Scripted bomb rates (one press per N ticks) cycled over the rounds: from frantic rounds that end
 * in a few seconds to calm ones that run into the sudden-death spiral.
 */
const BOMB_RATES: readonly number[] = [60, 300, 1500, 6000];
const SNAPSHOT_REPS = 20;

export interface BenchOptions {
  readonly rounds: number;
  readonly seed?: number;
}

export interface BenchResult {
  readonly rounds: number;
  readonly ticks: number;
  readonly meanRoundTicks: number;
  readonly maxRoundTicks: number;
  readonly stepMeanMs: number;
  readonly stepMaxMs: number;
  readonly snapshotRestoreMeanMs: number;
  readonly stateBytes: number;
  readonly errors: readonly string[];
}

/** Every state value must be a finite integer, positions inside the grid. */
function checkState(state: SimState): string | null {
  for (const [name, view] of Object.entries(state)) {
    if (name === 'buffer' || name === 'bytes') continue;
    const arr = view as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i] as number;
      if (!Number.isFinite(v) || !Number.isInteger(v)) return `${name}[${i}] = ${v}`;
    }
  }
  for (let s = 0; s < 4; s++) {
    const x = state.px[s] as number;
    const y = state.py[s] as number;
    if (x < 0 || y < 0 || x >= GRID_W * TILE || y >= GRID_H * TILE) {
      return `seat ${s} out of the grid at (${x}, ${y})`;
    }
  }
  return null;
}

export function runSimBench(opts: BenchOptions): BenchResult {
  const seed0 = opts.seed ?? 1;
  const ring = new Uint8Array(STATE_BYTES);
  const errors: string[] = [];
  let ticks = 0;
  let stepMs = 0;
  let stepMaxMs = 0;
  let snapMs = 0;
  let snapCount = 0;
  let maxRoundTicks = 0;

  for (let r = 0; r < opts.rounds; r++) {
    const seed = (seed0 + r * 7919) >>> 0;
    const arena = CLASSIC_ARENAS[r % CLASSIC_ARENAS.length]!;
    try {
      const state = createState({
        seed,
        arena,
        seats: [true, true, true, true],
        rules: { winsToMatch: 1 },
      });
      const script = new ScriptedInputs(seed, BOMB_RATES[(r >> 2) % BOMB_RATES.length]);
      let roundTicks = 0;
      for (;;) {
        const inputs = script.next();
        const t0 = performance.now();
        step(state, inputs);
        const dt = performance.now() - t0;
        stepMs += dt;
        if (dt > stepMaxMs) stepMaxMs = dt;
        roundTicks++;
        const phase = state.hdr[Hdr.PHASE];
        if (phase === Phase.ROUND_OVER || phase === Phase.MATCH_OVER) break;
        if (roundTicks >= MAX_ROUND_TICKS) {
          errors.push(`round ${r} (seed ${seed}, ${arena.id}) did not end`);
          break;
        }
        if (roundTicks % SNAPSHOT_EVERY === 0) {
          const s0 = performance.now();
          for (let k = 0; k < SNAPSHOT_REPS; k++) {
            snapshotInto(state, ring);
            restore(state, ring);
          }
          snapMs += performance.now() - s0;
          snapCount += SNAPSHOT_REPS;
        }
      }
      ticks += roundTicks;
      if (roundTicks > maxRoundTicks) maxRoundTicks = roundTicks;
      const bad = checkState(state);
      if (bad) errors.push(`round ${r} (seed ${seed}): ${bad}`);
    } catch (err) {
      errors.push(`round ${r} (seed ${seed}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const stepMeanMs = ticks > 0 ? stepMs / ticks : Number.NaN;
  const snapshotRestoreMeanMs = snapCount > 0 ? snapMs / snapCount : Number.NaN;
  if (!Number.isFinite(stepMeanMs)) errors.push('step time is not finite');
  if (!Number.isFinite(snapshotRestoreMeanMs)) errors.push('snapshot time is not finite');
  return {
    rounds: opts.rounds,
    ticks,
    meanRoundTicks: opts.rounds > 0 ? ticks / opts.rounds : 0,
    maxRoundTicks,
    stepMeanMs,
    stepMaxMs,
    snapshotRestoreMeanMs,
    stateBytes: STATE_BYTES,
    errors,
  };
}

/** Budget violations (empty = pass). */
export function budgetFailures(result: BenchResult, margin = SAFETY_MARGIN): string[] {
  const out: string[] = [];
  const stepLimit = STEP_BUDGET_MS / margin;
  const snapLimit = SNAPSHOT_BUDGET_MS / margin;
  if (!(result.stepMeanMs <= stepLimit)) {
    out.push(`mean step ${result.stepMeanMs.toFixed(4)} ms > ${stepLimit.toFixed(4)} ms`);
  }
  if (!(result.snapshotRestoreMeanMs <= snapLimit)) {
    out.push(
      `mean snapshot+restore ${result.snapshotRestoreMeanMs.toFixed(4)} ms > ${snapLimit.toFixed(4)} ms`,
    );
  }
  return out;
}

function readArg(args: readonly string[], name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v < 0) throw new Error(`--${name} needs a non-negative integer`);
  return v;
}

/** CLI entry (called by `scripts/run-ts.mjs`). Returns the process exit code. */
export function main(args: readonly string[]): number {
  const rounds = readArg(args, 'rounds', 1000);
  const seed = readArg(args, 'seed', 1);
  runSimBench({ rounds: Math.min(rounds, 20), seed: seed + 1_000_000 }); // JIT warm-up
  const result = runSimBench({ rounds, seed });
  const us = (ms: number) => `${(ms * 1000).toFixed(2)} µs`;
  console.log(`sim-bench: ${result.rounds} seeded 4-player rounds, ${result.ticks} ticks`);
  console.log(
    `  round length   mean ${result.meanRoundTicks.toFixed(0)} ticks, max ${result.maxRoundTicks}`,
  );
  console.log(
    `  step           mean ${us(result.stepMeanMs)}, max ${us(result.stepMaxMs)}  ` +
      `(budget ${us(STEP_BUDGET_MS)} ÷ ${SAFETY_MARGIN} = ${us(STEP_BUDGET_MS / SAFETY_MARGIN)})`,
  );
  console.log(
    `  snap+restore   mean ${us(result.snapshotRestoreMeanMs)}  ` +
      `(budget ${us(SNAPSHOT_BUDGET_MS)} ÷ ${SAFETY_MARGIN} = ${us(SNAPSHOT_BUDGET_MS / SAFETY_MARGIN)}), ` +
      `state ${result.stateBytes} B`,
  );
  const failures = [...result.errors, ...budgetFailures(result)];
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.log(failures.length === 0 ? 'sim-bench: OK' : 'sim-bench: FAILED');
  return failures.length === 0 ? 0 : 1;
}
