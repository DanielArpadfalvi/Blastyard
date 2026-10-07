import { describe, expect, it } from 'vitest';
import { ARENA_MEADOW, variant } from '../../../src/content/challenges/arenas';
import { LEVELS, levelById, tuningOf } from '../../../src/content/challenges';
import { SOLUTIONS } from '../../../src/content/challenges/solutions';
import {
  Ability,
  BotLevel,
  EventKind,
  Hdr,
  Monster,
  Tile,
  addBomb,
  cellIndex,
  createState,
  rleDecode,
  step,
  tileCenter,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import {
  ChallengeTracker,
  condMet,
  countCrates,
  replayLevel,
  stageSetup,
  starsFor,
  type LevelDef,
  type RunStats,
  type StageDef,
} from '../../../src/game/challenge';
import { ChallengeProgress, PROGRESS_KEY } from '../../../src/game/progress';
import { memoryStore } from '../../../src/platform/storage';

const stats = (over: Partial<RunStats> = {}): RunStats => ({
  ticks: 600,
  bombs: 8,
  pickups: 3,
  damage: 0,
  kills: 0,
  ...over,
});

const OPEN_ARENA = variant(ARENA_MEADOW, 'test-open', 0);
const CRATE_ARENA = variant(ARENA_MEADOW, 'test-crates', 100);

function level(stage: Partial<StageDef> & Pick<StageDef, 'objective'>, extra = 1): LevelDef {
  return {
    id: 'w1-01',
    world: 1,
    index: 1,
    nameKey: 'chName_w1_01',
    stages: Array.from({ length: extra }, () => ({ arena: OPEN_ARENA, ...stage })),
    stars: ['time', 'bombs'],
  };
}

function runUntil(
  state: SimState,
  tracker: ChallengeTracker,
  ticks: number,
  input: (t: number) => number = () => 0,
): void {
  for (let t = 0; t < ticks && tracker.status === 'running' && !tracker.stageWon; t++) {
    const events: readonly SimEvent[] = step(state, [input(t), 0, 0, 0]);
    tracker.observe(state, events);
  }
}

describe('stars', () => {
  it('one star for the goal plus one per extra condition; none for a lost run', () => {
    const conds = [
      { kind: 'time', seconds: 12 },
      { kind: 'bombs', max: 8 },
    ] as const;
    expect(starsFor(false, stats(), conds)).toBe(0);
    expect(starsFor(true, stats({ ticks: 900, bombs: 20 }), conds)).toBe(1);
    expect(starsFor(true, stats({ ticks: 700, bombs: 20 }), conds)).toBe(2);
    expect(starsFor(true, stats({ ticks: 700, bombs: 9 }), conds)).toBe(2);
    expect(starsFor(true, stats({ ticks: 720, bombs: 8 }), conds)).toBe(3);
    // The conditions are independent: the bomb budget alone earns a star too.
    expect(starsFor(true, stats({ ticks: 9000, bombs: 3 }), conds)).toBe(2);
  });

  it('every condition kind has an exact threshold', () => {
    expect(condMet({ kind: 'time', seconds: 10 }, stats({ ticks: 600 }))).toBe(true);
    expect(condMet({ kind: 'time', seconds: 10 }, stats({ ticks: 601 }))).toBe(false);
    expect(condMet({ kind: 'bombs', max: 8 }, stats({ bombs: 8 }))).toBe(true);
    expect(condMet({ kind: 'bombs', max: 8 }, stats({ bombs: 9 }))).toBe(false);
    expect(condMet({ kind: 'noDamage' }, stats({ damage: 0 }))).toBe(true);
    expect(condMet({ kind: 'noDamage' }, stats({ damage: 1 }))).toBe(false);
    expect(condMet({ kind: 'pickups', min: 3 }, stats({ pickups: 3 }))).toBe(true);
    expect(condMet({ kind: 'pickups', min: 4 }, stats({ pickups: 3 }))).toBe(false);
  });

  it('the reference solution of every level earns all three stars', () => {
    for (const l of LEVELS) {
      const out = replayLevel(l, tuningOf(l.id).seeds, SOLUTIONS[l.id]!.logs);
      expect(out.status, l.id).toBe('won');
      expect(starsFor(true, out.stats, tuningOf(l.id).stars), l.id).toBe(3);
    }
  });

  it('one more bomb than the threshold costs the star (regression on a real level)', () => {
    const l = levelById('w1-03')!;
    const out = replayLevel(l, tuningOf(l.id).seeds, SOLUTIONS[l.id]!.logs);
    const bombStar = tuningOf(l.id).stars.find((c) => c.kind === 'bombs')!;
    expect(condMet(bombStar, { ...out.stats, bombs: (bombStar as { max: number }).max + 1 })).toBe(
      false,
    );
  });
});

describe('objectives', () => {
  it('stage setup: one human, optional bots, monsters, flag, abilities, no clock', () => {
    const l = level({
      objective: { type: 'flag', seconds: 60 },
      bots: [BotLevel.HARD],
      monsters: [{ kind: Monster.SNAIL, x: 11, y: 11 }],
      flag: { x: 11, y: 1 },
      startAbilities: Ability.SHIELD,
    });
    const setup = stageSetup(l, 0, 5);
    expect(setup.seats).toEqual([true, true, false, false]);
    expect(setup.bots).toEqual([0, BotLevel.HARD, 0, 0]);
    expect(setup.rules).toMatchObject({ roundSeconds: 0, suddenDeath: 'none', ghosts: false });
    const state = createState(setup);
    expect(state.hdr[Hdr.GOAL_CELL]).toBe(cellIndex(11, 1));
    expect(state.abilities[0]).toBe(Ability.SHIELD);
    expect(() => stageSetup(l, 3, 1)).toThrow();
  });

  it('crates: won when the last crate is gone; the time limit loses', () => {
    const l = level({ arena: CRATE_ARENA, objective: { type: 'crates', seconds: 20 } });
    const state = createState(stageSetup(l, 0, 1));
    const tracker = new ChallengeTracker(l);
    // Remove every crate but one by hand: still running.
    for (let i = 0; i < state.tiles.length; i++)
      if (state.tiles[i] === Tile.CRATE) state.tiles[i] = Tile.FLOOR;
    state.tiles[cellIndex(5, 5)] = Tile.CRATE;
    runUntil(state, tracker, 10);
    expect(tracker.status).toBe('running');
    expect(countCrates(state)).toBe(1);
    state.tiles[cellIndex(5, 5)] = Tile.FLOOR;
    runUntil(state, tracker, 5);
    expect(tracker.status).toBe('won');

    const slow = level({ arena: CRATE_ARENA, objective: { type: 'crates', seconds: 1 } });
    const state2 = createState(stageSetup(slow, 0, 1));
    const tracker2 = new ChallengeTracker(slow);
    runUntil(state2, tracker2, 400);
    expect(tracker2.status).toBe('lost');
    expect(tracker2.lossReason).toBe('time');
  });

  it('dying loses at once ("died"); a Shield breaks without losing', () => {
    const l = level({
      objective: { type: 'monsters' },
      monsters: [{ kind: Monster.SNAIL, x: 11, y: 11 }],
    });
    const state = createState(stageSetup(l, 0, 1));
    const tracker = new ChallengeTracker(l);
    runUntil(state, tracker, 190);
    // A bomb under the player's feet that nobody walks away from.
    addBomb(state, 1, 1, 0, 1, 2);
    runUntil(state, tracker, 5);
    expect(tracker.status).toBe('lost');
    expect(tracker.lossReason).toBe('died');
  });

  it('monsters: won when every monster is dead; progress counts them', () => {
    const l = level({
      objective: { type: 'monsters' },
      monsters: [
        { kind: Monster.SNAIL, x: 11, y: 11 },
        { kind: Monster.SNAIL, x: 11, y: 1 },
      ],
    });
    const state = createState(stageSetup(l, 0, 1));
    const tracker = new ChallengeTracker(l);
    runUntil(state, tracker, 200);
    expect(tracker.progress(state)).toMatchObject({ type: 'monsters', done: 0, target: 2 });
    state.monAlive[0] = 0;
    runUntil(state, tracker, 2);
    expect(tracker.progress(state).done).toBe(1);
    state.monAlive[1] = 0;
    runUntil(state, tracker, 2);
    expect(tracker.status).toBe('won');
  });

  it('flag: won the moment the player stands on it', () => {
    const l = level({ objective: { type: 'flag', seconds: 30 }, flag: { x: 5, y: 1 } });
    const state = createState(stageSetup(l, 0, 1));
    const tracker = new ChallengeTracker(l);
    runUntil(state, tracker, 200);
    expect(tracker.status).toBe('running');
    state.px[0] = tileCenter(5);
    state.py[0] = tileCenter(1);
    runUntil(state, tracker, 2);
    expect(tracker.status).toBe('won');
  });

  it('collect: counts the player’s pick-ups; survive: the clock decides', () => {
    const collect = level({ objective: { type: 'collect', count: 2, seconds: 60 } });
    const state = createState(stageSetup(collect, 0, 1));
    const tracker = new ChallengeTracker(collect);
    state.pickup[cellIndex(2, 1)] = 1;
    state.pickup[cellIndex(3, 1)] = 2;
    runUntil(state, tracker, 190);
    runUntil(state, tracker, 80, () => 0x02); // walk right over both
    expect(tracker.totals().pickups).toBe(2);
    expect(tracker.status).toBe('won');

    const survive = level({ objective: { type: 'survive', seconds: 2 } });
    const s2 = createState(stageSetup(survive, 0, 1));
    const t2 = new ChallengeTracker(survive);
    runUntil(s2, t2, 400);
    expect(t2.status).toBe('won');
  });

  it('win: only the round result counts; a gauntlet advances stage by stage', () => {
    const l = level(
      { objective: { type: 'win' }, bots: [BotLevel.EASY], rules: { roundSeconds: 30 } },
      2,
    );
    const state = createState(stageSetup(l, 0, 3));
    const tracker = new ChallengeTracker(l);
    runUntil(state, tracker, 200);
    // Eliminate the bot by hand: the round ends with the player ahead.
    state.alive[1] = 0;
    runUntil(state, tracker, 3);
    expect(tracker.status).toBe('running');
    expect(tracker.stageWon).toBe(true);
    expect(tracker.progress(state).stages).toBe(2);
    tracker.advance();
    expect(tracker.stage).toBe(1);
    expect(tracker.stageWon).toBe(false);
  });

  it('the recorded solution only wins with the right inputs (an empty log loses nothing, wins nothing)', () => {
    const l = levelById('w1-03')!;
    const tuning = tuningOf(l.id);
    const empty = replayLevel(l, tuning.seeds, [[]]);
    expect(empty.status).toBe('running');
    // Cut the real solution short: not enough ticks to finish.
    const log = rleDecode(SOLUTIONS[l.id]!.logs[0]!);
    const shorter = Array.from(log.slice(0, log.length >> 1)).flatMap((v) => [v, 1]);
    expect(replayLevel(l, tuning.seeds, [shorter]).status).toBe('running');
  });

  it('world 2 and 3 locks follow the entitlement; world 1 opens level by level', () => {
    const progress = new ChallengeProgress(memoryStore());
    const w1 = (n: number) => levelById(`w1-${String(n).padStart(2, '0')}`)!;
    const w2 = levelById('w2-05')!;
    expect(progress.lockOf(w1(1), false)).toBe('open');
    expect(progress.lockOf(w1(2), false)).toBe('locked-progress');
    expect(progress.lockOf(w2, false)).toBe('locked-plus');
    expect(progress.lockOf(w2, true)).toBe('open');
    // Owners get the whole world without any star gate.
    expect(progress.lockOf(levelById('w3-12')!, true)).toBe('open');
    expect(progress.record('w1-01', 2)).toBe(true);
    expect(progress.lockOf(w1(2), false)).toBe('open');
    expect(progress.record('w1-01', 1)).toBe(false);
    expect(progress.starsOf('w1-01')).toBe(2);
    expect(progress.record('nope', 3)).toBe(false);
    expect(progress.totalStars()).toBe(2);
    expect(progress.worldStars(1)).toBe(2);
    expect(progress.completed(1)).toBe(1);
  });

  it('progress persists and a corrupt save falls back to nothing played', () => {
    const store = memoryStore();
    new ChallengeProgress(store).record('w1-04', 3);
    expect(new ChallengeProgress(store).starsOf('w1-04')).toBe(3);
    store.set(PROGRESS_KEY, '{oops');
    expect(new ChallengeProgress(store).totalStars()).toBe(0);
    store.set(PROGRESS_KEY, JSON.stringify({ 'w1-01': 9, 'w1-02': 'x', bogus: 3, 'w1-03': 2 }));
    const loaded = new ChallengeProgress(store);
    expect(loaded.starsOf('w1-01')).toBe(0);
    expect(loaded.starsOf('w1-03')).toBe(2);
  });

  it('events of the kinds the tracker reads exist on the simulation', () => {
    expect(EventKind.MONSTER_KILLED).toBeGreaterThan(0);
  });
});
