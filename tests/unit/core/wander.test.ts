import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN, CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import {
  EventKind,
  FUSE_TICKS,
  Hdr,
  Phase,
  ReplayRecorder,
  Tile,
  addBomb,
  cellIndex,
  createState,
  inputBomb,
  runReplay,
  snapshot,
  step,
  wanderHash,
  wanderInput,
  type SimState,
} from '../../../src/core';
import { tinyArena } from './helpers';

/** Steps `ticks` times with seat `bot` driven by the wander bot; returns the number of deaths. */
function runBot(state: SimState, bot: number, ticks: number): { deaths: number; pops: number } {
  const inputs = [0, 0, 0, 0];
  let deaths = 0;
  let pops = 0;
  for (let t = 0; t < ticks; t++) {
    inputs[bot] = wanderInput(state, bot);
    for (const e of step(state, inputs)) {
      if (e.kind === EventKind.DEATH) deaths++;
      if (e.kind === EventKind.BOMB_PLACED) pops++;
    }
  }
  return { deaths, pops };
}

describe('wander bot', () => {
  it('is a pure, read-only function of the state', () => {
    const s = createState({ seed: 3, arena: ARENA_GARDEN, seats: [true, true, false, false] });
    while (s.hdr[Hdr.PHASE] !== Phase.PLAYING) step(s, [0, 0, 0, 0]);
    for (let t = 0; t < 300; t++) {
      const before = snapshot(s);
      const a = wanderInput(s, 1);
      expect(snapshot(s)).toEqual(before);
      expect(wanderInput(s, 1)).toBe(a);
      step(s, [0, a, 0, 0]);
    }
  });

  it('sends nothing outside the playing phase or for inactive seats', () => {
    const s = createState({ seed: 3, arena: ARENA_GARDEN, seats: [true, true, false, false] });
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.COUNTDOWN);
    expect(wanderInput(s, 1)).toBe(0);
    while (s.hdr[Hdr.PHASE] !== Phase.PLAYING) step(s, [0, 0, 0, 0]);
    expect(wanderInput(s, 3)).toBe(0);
  });

  it('hash is deterministic and spreads its inputs', () => {
    expect(wanderHash(1, 2, 3, 4)).toBe(wanderHash(1, 2, 3, 4));
    const seen = new Set<number>();
    for (let e = 0; e < 64; e++) seen.add(wanderHash(7, 1, 1, e) % 121);
    expect(seen.size).toBeGreaterThan(30);
  });

  it('runs away from its own pop and survives the blast', () => {
    const s = tinyArena(['#######', '#1....#', '#######']);
    addBomb(s, 1, 1, 1, FUSE_TICKS, 2);
    const { deaths } = runBot(s, 1, FUSE_TICKS + 40);
    expect(deaths).toBe(0);
    expect(s.alive[1]).toBe(1);
    expect(s.px[1]! >> 8).toBeGreaterThanOrEqual(4);
  });

  it('turns a corner to get out of a blast line', () => {
    const s = tinyArena(['#####', '#1..#', '###.#', '###.#', '#####']);
    addBomb(s, 1, 1, 1, FUSE_TICKS, 3);
    expect(runBot(s, 1, FUSE_TICKS + 40).deaths).toBe(0);
    expect(s.py[1]! >> 8).toBeGreaterThanOrEqual(2);
  });

  it('never drops a pop it cannot escape', () => {
    const s = tinyArena(['#####', '#1+.#', '#####']);
    expect(runBot(s, 1, 1200).pops).toBe(0);
    expect(s.alive[1]).toBe(1);
  });

  it('digs through crates and lives', () => {
    const s = tinyArena(['#######', '#1+...#', '#.#####', '#.#####', '#...###', '#######']);
    const { deaths, pops } = runBot(s, 1, 3000);
    expect(pops).toBeGreaterThan(0);
    expect(s.tiles[cellIndex(2, 1)]).toBe(Tile.FLOOR);
    expect(deaths).toBe(0);
  });

  it('attacks an opponent standing in a clear blast line when it can escape', () => {
    // Seat 0 idles two cells to the right; the bot has an escape pocket below.
    let attacked = false;
    for (let seed = 0; seed < 8 && !attacked; seed++) {
      const s = tinyArena(['#######', '#1.0..#', '#.#####', '#.#####', '#######']);
      s.hdr[Hdr.SEED] = seed;
      attacked = inputBomb(wanderInput(s, 1));
    }
    expect(attacked).toBe(true);
  });

  it('plays whole bot-vs-bot matches to a result on every classic arena', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const arena = CLASSIC_ARENAS[seed % CLASSIC_ARENAS.length]!;
      const s = createState({
        seed,
        arena,
        seats: [true, true, false, false],
        rules: { winsToMatch: 1 },
      });
      const inputs = [0, 0, 0, 0];
      let crates = 0;
      let t = 0;
      for (; t < 30_000 && s.hdr[Hdr.PHASE] !== Phase.MATCH_OVER; t++) {
        inputs[0] = wanderInput(s, 0);
        inputs[1] = wanderInput(s, 1);
        for (const e of step(s, inputs)) if (e.kind === EventKind.CRATE_DESTROYED) crates++;
      }
      expect(s.hdr[Hdr.PHASE]).toBe(Phase.MATCH_OVER);
      expect(crates).toBeGreaterThan(5);
    }
  });

  it('a match against the bot replays from its input log alone', () => {
    const setup = { seed: 11, arena: ARENA_GARDEN, seats: [true, true, false, false] };
    const rec = new ReplayRecorder(setup);
    for (let t = 0; t < 2400; t++) rec.step([0, wanderInput(rec.state, 1), 0, 0]);
    const replay = rec.toReplay();
    const result = runReplay(replay, ARENA_GARDEN);
    expect(result.ticks).toBe(2400);
    expect(result.hashMatches).toBe(true);
    expect(result.hash).toBe(replay.finalHash);
  });
});
