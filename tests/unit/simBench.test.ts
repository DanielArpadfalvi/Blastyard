import { describe, expect, it } from 'vitest';
import {
  SAFETY_MARGIN,
  STEP_BUDGET_MS,
  budgetFailures,
  runSimBench,
  type BenchResult,
} from '../../scripts/sim-bench';

describe('sim bench', () => {
  it('runs seeded 4-player rounds without errors within the budget (3× margin)', () => {
    runSimBench({ rounds: 8, seed: 99 }); // JIT warm-up
    const result = runSimBench({ rounds: 40, seed: 7 });
    expect(result.errors).toEqual([]);
    expect(result.ticks).toBeGreaterThan(40 * 180);
    expect(Number.isFinite(result.stepMeanMs)).toBe(true);
    expect(Number.isFinite(result.snapshotRestoreMeanMs)).toBe(true);
    expect(result.stateBytes).toBeLessThanOrEqual(4096);
    // Timing assertions are meaningless under coverage instrumentation.
    if (process.env.BLASTYARD_COVERAGE !== '1') expect(budgetFailures(result)).toEqual([]);
  }, 60_000);

  it('reports budget violations with the safety margin applied', () => {
    const base: BenchResult = {
      rounds: 1,
      ticks: 1,
      meanRoundTicks: 1,
      maxRoundTicks: 1,
      stepMeanMs: STEP_BUDGET_MS / SAFETY_MARGIN,
      stepMaxMs: 0,
      snapshotRestoreMeanMs: 0.001,
      stateBytes: 2000,
      errors: [],
    };
    expect(budgetFailures(base)).toEqual([]);
    expect(budgetFailures({ ...base, stepMeanMs: STEP_BUDGET_MS / 2 })).toHaveLength(1);
    expect(budgetFailures({ ...base, snapshotRestoreMeanMs: Number.NaN })).toHaveLength(1);
  });
});
