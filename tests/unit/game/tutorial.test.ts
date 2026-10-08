import { describe, expect, it } from 'vitest';
import { tuningOf } from '../../../src/content/challenges';
import { SOLUTIONS } from '../../../src/content/challenges/solutions';
import { validateLevelStructure } from '../../../src/content/challenges/validate';
import { TUTORIAL, TUTORIAL_STEPS, chainOpening } from '../../../src/content/tutorial';
import {
  Dir,
  EventKind,
  Pickup,
  createState,
  encodeInput,
  rleEncode,
  step,
  type SimEvent,
} from '../../../src/core';
import { ChallengeTracker, replayLevel, stageSetup } from '../../../src/game/challenge';
import { singleStage } from '../../../src/game/solver';
import { TIPS_KEY, TipsStore, sanitizeTips, tipForEvent } from '../../../src/game/tips';
import { memoryStore } from '../../../src/platform/storage';

const CHAIN_STEP = 3;

function bytes(...runs: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [v, n] of runs) for (let i = 0; i < n; i++) out.push(v);
  return out;
}

describe('tutorial content', () => {
  it('has five valid steps and a reference solution that wins all of them', () => {
    expect(TUTORIAL.stages).toHaveLength(TUTORIAL_STEPS);
    expect(validateLevelStructure(TUTORIAL)).toEqual([]);
    const tuning = tuningOf(TUTORIAL.id);
    const outcome = replayLevel(TUTORIAL, tuning.seeds, SOLUTIONS[TUTORIAL.id]!.logs);
    expect(outcome.status).toBe('won');
    expect(outcome.stagesWon).toBe(TUTORIAL_STEPS);
    // About 90 s of play for a first-timer: the bot needs well under that.
    expect(outcome.stats.ticks / 60).toBeLessThan(90);
  });
});

describe('chain objective', () => {
  const chain = singleStage(TUTORIAL, CHAIN_STEP);

  it('counts a pop set off by another pop', () => {
    const outcome = replayLevel(chain, [1], [rleEncode(chainOpening())]);
    expect(outcome.status).toBe('won');
    expect(outcome.stats.bombs).toBe(2);
  });

  it('does not count two pops that go off on their own', () => {
    const pop = encodeInput(Dir.NONE, Dir.NONE, true);
    // Pop, walk two tiles right, pop again (out of the first flame), duck below, wait.
    const log = bytes(
      [0, 182],
      [pop, 1],
      [encodeInput(Dir.RIGHT), 48],
      [pop, 1],
      [encodeInput(Dir.RIGHT), 32],
      [encodeInput(Dir.DOWN), 16],
      [0, 400],
    );
    const outcome = replayLevel(chain, [1], [rleEncode(log)]);
    expect(outcome.stats.bombs).toBe(2);
    expect(outcome.status).not.toBe('won');
  });

  it('starts the tracker at a later stage (a retried step)', () => {
    const tracker = new ChallengeTracker(TUTORIAL, CHAIN_STEP);
    expect(tracker.stage).toBe(CHAIN_STEP);
    expect(tracker.stageDef.objective.type).toBe('chain');
    const state = createState(stageSetup(TUTORIAL, CHAIN_STEP, 1));
    const inputs = new Uint8Array(4);
    const log = chainOpening();
    for (let t = 0; t < log.length && !tracker.stageWon; t++) {
      inputs[0] = log[t]!;
      tracker.observe(state, step(state, inputs));
    }
    // Step 4 of 5: won, the run goes on with step 5.
    expect(tracker.stageWon).toBe(true);
    expect(tracker.status).toBe('running');
    expect(tracker.progress(state)).toMatchObject({ stage: CHAIN_STEP + 1, stages: 5 });
  });
});

describe('first-time tips', () => {
  const ev = (kind: number, seat: number, value = 0): SimEvent => ({
    kind: kind as SimEvent['kind'],
    tick: 1,
    seat,
    cell: 0,
    value,
  });

  it('maps events of human seats to tips', () => {
    const humans = [0, 2];
    expect(tipForEvent(ev(EventKind.PICKUP_COLLECTED, 0, Pickup.KICK), humans)).toBe('kick');
    expect(tipForEvent(ev(EventKind.PICKUP_COLLECTED, 0, Pickup.FLAME), humans)).toBeNull();
    expect(tipForEvent(ev(EventKind.PICKUP_COLLECTED, 1, Pickup.KICK), humans)).toBeNull();
    expect(tipForEvent(ev(EventKind.BOMB_KICKED, 2), humans)).toBe('kick');
    expect(tipForEvent(ev(EventKind.JINX_CAUGHT, 2, 1), humans)).toBe('jinx');
    expect(tipForEvent(ev(EventKind.JINX_PASSED, 1, 0), humans)).toBe('jinx');
    expect(tipForEvent(ev(EventKind.JINX_PASSED, 0, 3), humans)).toBeNull();
    expect(tipForEvent(ev(EventKind.SUDDEN_DEATH, -1), humans)).toBe('suddenDeath');
    expect(tipForEvent(ev(EventKind.SUDDEN_DEATH, -1), [])).toBeNull();
  });

  it('shows each tip once, persisted across restarts', () => {
    const store = memoryStore();
    let tips = new TipsStore(store);
    expect(tips.tutorialDone).toBe(false);
    expect(tips.take('kick')).toBe(true);
    expect(tips.take('kick')).toBe(false);
    tips.setTutorialDone();
    tips = new TipsStore(store);
    expect(tips.tutorialDone).toBe(true);
    expect(tips.seen('kick')).toBe(true);
    expect(tips.take('kick')).toBe(false);
    expect(tips.take('jinx')).toBe(true);
  });

  it('falls back to defaults on corrupt data', () => {
    expect(new TipsStore(memoryStore({ [TIPS_KEY]: '{oops' })).tutorialDone).toBe(false);
    expect(sanitizeTips({ tutorialDone: 'yes', shown: ['kick', 'boom', 3] })).toEqual({
      tutorialDone: false,
      shown: ['kick'],
      notices: [],
    });
  });
});
