import { describe, expect, it } from 'vitest';
import {
  CHAOS_RULES,
  EventKind,
  FAST_RULES,
  Hdr,
  Phase,
  ReplayRecorder,
  SIM_VERSION,
  appendInputs,
  createState,
  forEachTick,
  hashHex,
  rleDecode,
  rleEncode,
  rleLength,
  runReplay,
  stateHash,
  step,
  type EventKindId,
  type MatchSetup,
  type Replay,
  type SimEvent,
} from '../../../src/core';
import {
  ARENA_COURTYARD,
  ARENA_CROSSROADS,
  ARENA_GARDEN,
  CLASSIC_ARENAS,
} from '../../../src/content/arenas/classic';

import { ScriptedInputs } from '../../../scripts/scripted-inputs';

const MAX_TICKS = 200_000;

interface Golden {
  readonly name: string;
  readonly setup: MatchSetup;
  /** Scripted players press the bomb button on about one tick in this many. */
  readonly bombOneIn: number;
  /** Event kinds the scripted match must produce (keeps the golden run meaningful). */
  readonly covers: readonly EventKindId[];
  readonly tick1: string;
  readonly tick600: string;
  readonly endTick: number;
  readonly end: string;
}

/**
 * Golden hashes (SIM_VERSION 2). Any change here means the simulation changed: bump SIM_VERSION,
 * then update these values in the same change.
 */
const GOLDEN: readonly Golden[] = [
  {
    name: 'classic FFA, 4 seats, garden',
    setup: { seed: 101, arena: ARENA_GARDEN, seats: [true, true, true, true] },
    bombOneIn: 60,
    covers: [EventKind.BOMB_EXPLODED, EventKind.CRATE_DESTROYED, EventKind.DEATH],
    tick1: '1503ce86',
    tick600: 'ccde81ba',
    endTick: 4779,
    end: '098dbe72',
  },
  {
    name: 'fast 2v2, crossroads',
    setup: {
      seed: 202,
      arena: ARENA_CROSSROADS,
      seats: [true, true, true, true],
      teams: [0, 1, 0, 1],
      rules: FAST_RULES,
    },
    bombOneIn: 120,
    covers: [EventKind.BOMB_EXPLODED, EventKind.DEATH],
    tick1: 'e01023ac',
    tick600: '2835aadd',
    endTick: 3146,
    end: '468146ac',
  },
  {
    name: 'chaos, 3 seats, courtyard, 15 s rounds into sudden death, first to 1',
    setup: {
      seed: 303,
      arena: ARENA_COURTYARD,
      seats: [true, false, true, true],
      rules: { ...CHAOS_RULES, winsToMatch: 1, roundSeconds: 15 },
    },
    bombOneIn: 2000,
    covers: [
      EventKind.PICKUP_COLLECTED,
      EventKind.SUDDEN_DEATH,
      EventKind.BLOCK_DROPPED,
      EventKind.DEATH,
    ],
    tick1: '73720c3e',
    tick600: '96f47a69',
    endTick: 1380,
    end: '3ffdba95',
  },
];

interface Played {
  readonly hashes: Map<number, string>;
  readonly endTick: number;
  readonly end: string;
  readonly events: SimEvent[];
  readonly recorder: ReplayRecorder;
}

function playScripted(setup: MatchSetup, bombOneIn = 60): Played {
  const recorder = new ReplayRecorder(setup);
  const script = new ScriptedInputs(setup.seed, bombOneIn);
  const hashes = new Map<number, string>();
  const events: SimEvent[] = [];
  let tick = 0;
  while (recorder.state.hdr[Hdr.PHASE] !== Phase.MATCH_OVER && tick < MAX_TICKS) {
    events.push(...recorder.step(script.next()));
    tick++;
    if (tick === 1 || tick === 600) hashes.set(tick, hashHex(stateHash(recorder.state)));
  }
  return { hashes, endTick: tick, end: hashHex(stateHash(recorder.state)), events, recorder };
}

describe('input log (RLE)', () => {
  it('round-trips and merges equal neighbours', () => {
    const ticks = [0, 0, 0, 0x40, 0x40, 0x02020202, 0, 0xffffffff];
    const log = rleEncode(ticks);
    expect(log).toEqual([0, 3, 0x40, 2, 0x02020202, 1, 0, 1, 0xffffffff, 1]);
    expect(Array.from(rleDecode(log))).toEqual(ticks);
    expect(rleLength(log)).toBe(8);
    const seen: number[] = [];
    forEachTick(log, (p) => seen.push(p));
    expect(seen).toEqual(ticks);
    const incremental: number[] = [];
    for (const t of ticks) appendInputs(incremental, t);
    expect(incremental).toEqual(log);
  });

  it('rejects malformed logs', () => {
    expect(() => rleLength([1])).toThrow(RangeError);
    expect(() => rleLength([1, 0])).toThrow(RangeError);
    expect(() => rleLength([-1, 2])).toThrow(RangeError);
    expect(() => rleDecode([1.5, 2])).toThrow(RangeError);
  });
});

describe('golden matches', () => {
  for (const golden of GOLDEN) {
    it(`${golden.name}: hashes at ticks 1 / 600 / end`, () => {
      const played = playScripted(golden.setup, golden.bombOneIn);
      expect(played.recorder.state.hdr[Hdr.PHASE]).toBe(Phase.MATCH_OVER);
      const kinds = new Set(played.events.map((e) => e.kind));
      for (const kind of golden.covers) expect(kinds.has(kind), `kind ${kind}`).toBe(true);
      expect({
        tick1: played.hashes.get(1),
        tick600: played.hashes.get(600),
        endTick: played.endTick,
        end: played.end,
      }).toEqual({
        tick1: golden.tick1,
        tick600: golden.tick600,
        endTick: golden.endTick,
        end: golden.end,
      });
    });
  }
});

describe('replay', () => {
  it('a recorded log replays to the same hash (also through JSON)', () => {
    const played = playScripted(GOLDEN[0]!.setup, GOLDEN[0]!.bombOneIn);
    const replay = played.recorder.toReplay();
    expect(replay.simVersion).toBe(SIM_VERSION);
    expect(replay.arenaId).toBe('garden');
    expect(rleLength(replay.inputs)).toBe(played.endTick);
    // Held directions compress: far fewer runs than ticks.
    expect(replay.inputs.length / 2).toBeLessThan(played.endTick / 2);

    const json = JSON.parse(JSON.stringify(replay)) as Replay;
    const result = runReplay(json, ARENA_GARDEN);
    expect(result.ticks).toBe(played.endTick);
    expect(result.hash).toBe(played.end);
    expect(result.hashMatches).toBe(true);
  });

  it('replays team and rule setups, and flags a tampered log', () => {
    const played = playScripted(GOLDEN[1]!.setup, GOLDEN[1]!.bombOneIn);
    const replay = played.recorder.toReplay();
    expect(replay.teams).toEqual([0, 1, 0, 1]);
    expect(runReplay(replay, ARENA_CROSSROADS).hashMatches).toBe(true);
    const tampered: Replay = { ...replay, inputs: replay.inputs.slice() };
    tampered.inputs[0] = ((tampered.inputs[0] as number) ^ 0x02) >>> 0;
    tampered.inputs[1] = (tampered.inputs[1] as number) + 400; // keep pressing well into round 1
    expect(runReplay(tampered, ARENA_CROSSROADS).hashMatches).toBe(false);
  });

  it('refuses another SIM_VERSION or the wrong arena', () => {
    const replay: Replay = {
      simVersion: SIM_VERSION + 1,
      seed: 1,
      arenaId: 'garden',
      seats: [true, true, false, false],
      inputs: [0, 10],
    };
    expect(() => runReplay(replay, ARENA_GARDEN)).toThrow(/SIM_VERSION/);
    expect(() => runReplay({ ...replay, simVersion: SIM_VERSION }, ARENA_CROSSROADS)).toThrow(
      /arena/,
    );
  });

  it('every classic arena runs a scripted match to the end', () => {
    for (const arena of CLASSIC_ARENAS) {
      const played = playScripted({
        seed: 11,
        arena,
        seats: [true, true, true, true],
        rules: { winsToMatch: 1 },
      });
      expect(played.recorder.state.hdr[Hdr.PHASE], arena.id).toBe(Phase.MATCH_OVER);
    }
  });
});

describe('event stream of a full round', () => {
  it('countdown → play → eliminations → round and match end, with tick ids', () => {
    const played = playScripted(GOLDEN[2]!.setup, GOLDEN[2]!.bombOneIn);
    const { events, endTick } = played;
    const state = played.recorder.state;

    expect(events.slice(0, 4).map((e) => [e.tick, e.kind, e.value])).toEqual([
      [1, EventKind.COUNTDOWN, 3],
      [61, EventKind.COUNTDOWN, 2],
      [121, EventKind.COUNTDOWN, 1],
      [180, EventKind.ROUND_START, 1],
    ]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.tick).toBeGreaterThanOrEqual(events[i - 1]!.tick);
    }
    expect(events.every((e) => e.tick >= 1 && e.tick <= endTick)).toBe(true);

    const last = events.slice(-2);
    expect(last.map((e) => [e.tick, e.kind])).toEqual([
      [endTick, EventKind.ROUND_END],
      [endTick, EventKind.MATCH_END],
    ]);
    const winner = state.hdr[Hdr.MATCH_WINNER] as number;
    expect(last[0]!.value).toBe(winner);
    expect(state.alive[winner]).toBe(1);

    // Seats 0, 2, 3 play; everyone but the winner was eliminated exactly once.
    const deaths = events.filter((e) => e.kind === EventKind.DEATH);
    expect(deaths.map((e) => e.seat).sort()).toEqual([0, 2, 3].filter((s) => s !== winner));
    const placed = events.filter((e) => e.kind === EventKind.BOMB_PLACED);
    const exploded = events.filter((e) => e.kind === EventKind.BOMB_EXPLODED);
    expect(placed.length).toBeGreaterThan(0);
    expect(exploded.length).toBeLessThanOrEqual(
      placed.length + events.filter((e) => e.kind === EventKind.GHOST_BOMB).length,
    );
    expect(placed.every((e) => e.seat !== 1)).toBe(true);
    // A seat's own placements stop after its death (ghosts drop GHOST_BOMB instead).
    for (const d of deaths) {
      expect(placed.some((e) => e.seat === d.seat && e.tick > d.tick)).toBe(false);
    }
  });

  it('events from a restored snapshot repeat with identical tick ids (rollback-safe)', () => {
    const state = createState(GOLDEN[0]!.setup);
    const script = new ScriptedInputs(101);
    const log: Uint8Array[] = [];
    for (let t = 0; t < 900; t++) log.push(script.next().slice());
    for (let t = 0; t < 700; t++) step(state, log[t]!);
    const snap = state.bytes.slice();
    const first: SimEvent[] = [];
    for (let t = 700; t < 900; t++) first.push(...step(state, log[t]!));
    state.bytes.set(snap);
    const second: SimEvent[] = [];
    for (let t = 700; t < 900; t++) second.push(...step(state, log[t]!));
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});
