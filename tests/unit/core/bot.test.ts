import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN, CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import {
  BotLevel,
  DANGER_SAFE,
  EventKind,
  FUSE_TICKS,
  Hdr,
  Phase,
  ReplayRecorder,
  RngStream,
  Tile,
  addBomb,
  botLevel,
  cellIndex,
  computeDanger,
  createState,
  dStart,
  runReplay,
  setBotLevel,
  snapshot,
  restore,
  stateHash,
  step,
  type SimState,
} from '../../../src/core';
import { runPairing } from '../../../scripts/bot-league';
import { tinyArena } from './helpers';

const NONE = [0, 0, 0, 0];

function runBot(state: SimState, ticks: number): { deaths: number; pops: number } {
  let deaths = 0;
  let pops = 0;
  for (let t = 0; t < ticks; t++) {
    for (const e of step(state, NONE)) {
      if (e.kind === EventKind.DEATH) deaths++;
      if (e.kind === EventKind.BOMB_PLACED) pops++;
    }
  }
  return { deaths, pops };
}

describe('bot configuration', () => {
  it('stores a level per seat in the state header', () => {
    const s = tinyArena(['#####', '#0.1#', '#####']);
    setBotLevel(s, 1, BotLevel.HARD);
    setBotLevel(s, 3, BotLevel.EXPERT);
    expect([0, 1, 2, 3].map((k) => botLevel(s, k))).toEqual([0, 3, 0, 4]);
    setBotLevel(s, 1, BotLevel.NONE);
    expect(botLevel(s, 1)).toBe(0);
    expect(() => setBotLevel(s, 0, 5)).toThrow(RangeError);
  });

  it('createState applies MatchSetup.bots', () => {
    const s = createState({
      seed: 1,
      arena: ARENA_GARDEN,
      seats: [true, true, true, false],
      bots: [0, BotLevel.EASY, BotLevel.NORMAL, 0],
    });
    expect([0, 1, 2].map((k) => botLevel(s, k))).toEqual([0, 1, 2]);
  });
});

describe('danger map', () => {
  it('marks the blast cross with the time until it burns and stops at crates and pillars', () => {
    const s = tinyArena(['#########', '#0..+...#', '#########']);
    addBomb(s, 1, 1, 3, 100, 5);
    computeDanger(s, 0, 0, true);
    expect(dStart[cellIndex(1, 1)]).toBe(100);
    expect(dStart[cellIndex(3, 1)]).toBe(100);
    expect(dStart[cellIndex(5, 1)]).toBe(DANGER_SAFE);
  });

  it('propagates chain reactions (4 ticks per link) and can be switched off', () => {
    const s = tinyArena(['###########', '#0........#', '###########']);
    addBomb(s, 2, 1, 3, 100, 2);
    addBomb(s, 4, 1, 3, 140, 2);
    computeDanger(s, 0, 0, true);
    // Bomb B is lit by A's blast at tick 100 and goes off at 104: its far end burns then.
    expect(dStart[cellIndex(6, 1)]).toBe(104);
    computeDanger(s, 0, 0, false);
    expect(dStart[cellIndex(6, 1)]).toBe(140);
  });

  it('hides other seats fresh bombs for the reaction delay, never its own', () => {
    const s = tinyArena(['#######', '#0...1#', '#######']);
    addBomb(s, 4, 1, 1, FUSE_TICKS, 2);
    computeDanger(s, 0, 24, true);
    expect(dStart[cellIndex(4, 1)]).toBe(DANGER_SAFE);
    computeDanger(s, 1, 24, true);
    expect(dStart[cellIndex(4, 1)]).toBe(FUSE_TICKS);
  });
});

describe('bot behaviour', () => {
  it('runs away from its own pop (BFS escape) and survives', () => {
    const s = tinyArena(['#######', '#1....#', '#######']);
    setBotLevel(s, 1, BotLevel.NORMAL);
    addBomb(s, 1, 1, 1, FUSE_TICKS, 2);
    expect(runBot(s, FUSE_TICKS + 40).deaths).toBe(0);
    expect(s.px[1]! >> 8).toBeGreaterThanOrEqual(4);
  });

  it('turns a corner to get out of a blast line', () => {
    const s = tinyArena(['#####', '#1..#', '###.#', '###.#', '#####']);
    setBotLevel(s, 1, BotLevel.EXPERT);
    addBomb(s, 1, 1, 1, FUSE_TICKS, 3);
    expect(runBot(s, FUSE_TICKS + 40).deaths).toBe(0);
    expect(s.py[1]! >> 8).toBeGreaterThanOrEqual(2);
  });

  it('never drops a pop it cannot escape', () => {
    for (const level of [BotLevel.EASY, BotLevel.EXPERT]) {
      const s = tinyArena(['#####', '#1+.#', '#####']);
      setBotLevel(s, 1, level);
      expect(runBot(s, 1200).pops).toBe(0);
      expect(s.alive[1]).toBe(1);
    }
  });

  it('digs through crates and lives', () => {
    const s = tinyArena(['#######', '#1+...#', '#.#####', '#.#####', '#...###', '#######']);
    setBotLevel(s, 1, BotLevel.NORMAL);
    const { deaths, pops } = runBot(s, 3000);
    expect(pops).toBeGreaterThan(0);
    expect(s.tiles[cellIndex(2, 1)]).toBe(Tile.FLOOR);
    expect(deaths).toBe(0);
  });

  it('a bot seat ignores the input it is given', () => {
    const s = tinyArena(['#######', '#1....#', '#######']);
    setBotLevel(s, 1, BotLevel.NORMAL);
    const t = tinyArena(['#######', '#1....#', '#######']);
    setBotLevel(t, 1, BotLevel.NORMAL);
    for (let k = 0; k < 120; k++) {
      step(s, [0, 0, 0, 0]);
      step(t, [0, 0xff, 0, 0]);
    }
    expect(stateHash(s)).toBe(stateHash(t));
  });

  it('draws only from its own RNG stream', () => {
    const s = createState({
      seed: 5,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      bots: [BotLevel.EXPERT, BotLevel.EASY, 0, 0],
    });
    const arena0 = Array.from(s.rng.slice(RngStream.ARENA * 4, RngStream.ARENA * 4 + 4));
    for (let t = 0; t < 900; t++) step(s, NONE);
    expect(Array.from(s.rng.slice(RngStream.ARENA * 4, RngStream.ARENA * 4 + 4))).toEqual(arena0);
    const ai = RngStream.AI0;
    const moved = [0, 1].some(
      (k) =>
        s.rng[(ai + k) * 4]! !==
        createState({
          seed: 5,
          arena: ARENA_GARDEN,
          seats: [true, true, false, false],
        }).rng[(ai + k) * 4]!,
    );
    expect(moved).toBe(true);
  });
});

describe('bots inside step (replay, snapshots)', () => {
  const setup = {
    seed: 11,
    arena: ARENA_GARDEN,
    seats: [true, true, true, false],
    bots: [BotLevel.NONE, BotLevel.HARD, BotLevel.NORMAL, 0],
  };

  it('a match with bots replays from its setup and the human log alone', () => {
    const rec = new ReplayRecorder(setup);
    for (let t = 0; t < 2400; t++) rec.step([0, 0, 0, 0]);
    const replay = rec.toReplay();
    const result = runReplay(replay, ARENA_GARDEN);
    expect(result.ticks).toBe(2400);
    expect(result.hashMatches).toBe(true);
  });

  it('restoring a snapshot mid-match continues identically (the bot memory is in the state)', () => {
    const a = createState(setup);
    for (let t = 0; t < 700; t++) step(a, NONE);
    const snap = snapshot(a);
    for (let t = 0; t < 700; t++) step(a, NONE);
    const b = createState(setup);
    restore(b, snap);
    for (let t = 0; t < 700; t++) step(b, NONE);
    expect(stateHash(b)).toBe(stateHash(a));
  });

  it('plays a bot-vs-bot match to a result on every classic arena', () => {
    for (let k = 0; k < CLASSIC_ARENAS.length; k++) {
      const s = createState({
        seed: k + 1,
        arena: CLASSIC_ARENAS[k]!,
        seats: [true, true, false, false],
        bots: [BotLevel.NORMAL, BotLevel.NORMAL, 0, 0],
        rules: { winsToMatch: 1 },
      });
      let crates = 0;
      for (let t = 0; t < 30_000 && s.hdr[Hdr.PHASE] !== Phase.MATCH_OVER; t++) {
        for (const e of step(s, NONE)) if (e.kind === EventKind.CRATE_DESTROYED) crates++;
      }
      expect(s.hdr[Hdr.PHASE]).toBe(Phase.MATCH_OVER);
      expect(crates).toBeGreaterThan(5);
    }
  }, 30_000);
});

describe('bot league (smoke)', () => {
  it('Expert beats Easy over a handful of seeded matches', () => {
    const r = runPairing(BotLevel.EXPERT, BotLevel.EASY, 6, 1);
    expect(r.winsA).toBeGreaterThan(r.winsB);
  }, 60_000);
});
