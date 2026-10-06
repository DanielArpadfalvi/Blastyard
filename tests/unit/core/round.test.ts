import { describe, expect, it } from 'vitest';
import {
  BombFlag,
  CHAOS_RULES,
  CLASSIC_RULES,
  COUNTDOWN_TICKS,
  DEFAULT_POWERUP_WEIGHTS,
  Dir,
  EventKind,
  FAST_RULES,
  GHOST_BOMB_COOLDOWN,
  GHOST_BOMB_FUSE,
  GRID_W,
  Hdr,
  NO_SIDE,
  Phase,
  RULE_PRESETS,
  ROUND_END_TICKS,
  RuleFlag,
  SD_INTERVAL,
  SD_PAUSE_AT,
  SD_PAUSE_TICKS,
  SPIRAL,
  Tile,
  addBomb,
  bombCount,
  bombsInUse,
  cellIndex,
  createState,
  encodeInput,
  stateHash,
  step,
  tileCenter,
  toTile,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import { ARENA_GARDEN } from '../../../src/content/arenas/classic';
import { only, placeSeat, skipCountdown, tinyArena } from './helpers';

const IDLE = [0, 0, 0, 0];
const BOMB = encodeInput(Dir.NONE, Dir.NONE, true);
const C = tileCenter;

function run(state: SimState, ticks: number, inputs: readonly number[] = IDLE): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...step(state, inputs));
  return events;
}

function ofKind(events: readonly SimEvent[], kind: number): SimEvent[] {
  return events.filter((e) => e.kind === kind);
}

/** 13×13 arena with an open 11×11 interior. */
function openArena(): string[] {
  const rows = ['#############'];
  for (let y = 1; y <= 11; y++) rows.push('#...........#');
  rows.push('#############');
  return rows;
}

function withSeats(rows: string[], seats: Record<string, [number, number]>): string[] {
  const out = rows.slice();
  for (const [ch, [x, y]] of Object.entries(seats)) {
    const row = out[y] as string;
    out[y] = row.slice(0, x) + ch + row.slice(x + 1);
  }
  return out;
}

/** Kills `seat` right now with a 1-tick bomb on its tile (owner = `owner`). */
function blast(state: SimState, seat: number, owner = seat): SimEvent[] {
  addBomb(state, toTile(state.px[seat] as number), toTile(state.py[seat] as number), owner, 1, 1);
  return run(state, 1);
}

describe('round: countdown', () => {
  it('counts 3-2-1 over 180 ticks, then starts the round; nothing moves before', () => {
    const s = createState({ seed: 1, arena: ARENA_GARDEN, seats: [true, true, false, false] });
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.COUNTDOWN);
    const start = [s.px[0], s.py[0]];
    const events = run(s, COUNTDOWN_TICKS, only(0, encodeInput(Dir.RIGHT, Dir.NONE, true)));
    expect(events.map((e) => [e.tick, e.kind, e.value])).toEqual([
      [1, EventKind.COUNTDOWN, 3],
      [61, EventKind.COUNTDOWN, 2],
      [121, EventKind.COUNTDOWN, 1],
      [180, EventKind.ROUND_START, 1],
    ]);
    expect([s.px[0], s.py[0]]).toEqual(start);
    expect(bombCount(s)).toBe(0);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
    step(s, only(0, encodeInput(Dir.RIGHT)));
    expect(s.px[0]).toBe((start[0] as number) + 16);
  });
});

describe('round: clock and sudden death', () => {
  it('the spiral covers the interior ring by ring, clockwise from the top-left', () => {
    expect(SPIRAL).toHaveLength(121);
    expect(new Set(SPIRAL).size).toBe(121);
    expect(SPIRAL.slice(0, 3)).toEqual([cellIndex(1, 1), cellIndex(2, 1), cellIndex(3, 1)]);
    expect(SPIRAL[10]).toBe(cellIndex(11, 1));
    expect(SPIRAL[120]).toBe(cellIndex(6, 6));
    const ring = (c: number) => {
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      return Math.max(Math.abs(x - 6), Math.abs(y - 6));
    };
    // Exactly the central 5×5 is left after the pause slot.
    expect(SPIRAL.slice(0, SD_PAUSE_AT).every((c) => ring(c) >= 3)).toBe(true);
    expect(SPIRAL.slice(SD_PAUSE_AT).every((c) => ring(c) <= 2)).toBe(true);
  });

  it('starts sudden death when the clock runs out; the first block eliminates seat 0', () => {
    const s = createState({
      seed: 2,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      rules: { roundSeconds: 10 },
    });
    skipCountdown(s);
    expect(s.hdr[Hdr.ROUND_TIME]).toBe(600);
    const before = run(s, 599);
    expect(ofKind(before, EventKind.SUDDEN_DEATH)).toHaveLength(0);
    const sd = step(s, IDLE);
    expect(sd.map((e) => [e.tick, e.kind])).toEqual([
      [COUNTDOWN_TICKS + 600, EventKind.SUDDEN_DEATH],
    ]);
    const drop = run(s, SD_INTERVAL);
    const tick = COUNTDOWN_TICKS + 600 + SD_INTERVAL;
    expect(drop.map((e) => [e.tick, e.kind, e.seat, e.cell, e.value])).toEqual([
      [tick, EventKind.BLOCK_DROPPED, 255, cellIndex(1, 1), 0],
      [tick, EventKind.DEATH, 0, cellIndex(1, 1), 255],
      [tick, EventKind.ROUND_END, 255, -1, 1],
    ]);
    expect(s.tiles[cellIndex(1, 1)]).toBe(Tile.WALL);
  });

  it('drops a block every 15 ticks, pauses 10 s at 5×5, then closes – simultaneous end = draw', () => {
    const s = tinyArena(withSeats(openArena(), { '0': [6, 6] }));
    placeSeat(s, 1, C(6), C(6));
    s.hdr[Hdr.RULE_FLAGS] = RuleFlag.SUDDEN_DEATH;
    s.hdr[Hdr.ROUND_TICKS] = 1;
    s.hdr[Hdr.ROUND_TIME] = 1;
    const crate = SPIRAL[5] as number;
    s.tiles[crate] = Tile.CRATE;
    s.hidden[crate] = 3;
    addBomb(s, 3, 3, 0, 5000, 1); // a bomb under a falling block vanishes without exploding
    const events = run(s, 2500);
    expect(ofKind(events, EventKind.SUDDEN_DEATH).map((e) => e.tick)).toEqual([1]);
    const drops = ofKind(events, EventKind.BLOCK_DROPPED);
    expect(drops).toHaveLength(121);
    expect(drops.map((e) => e.cell)).toEqual(SPIRAL);
    const ticks = drops.map((e) => e.tick);
    expect(ticks[0]).toBe(1 + SD_INTERVAL);
    expect((ticks[SD_PAUSE_AT - 1] as number) - (ticks[SD_PAUSE_AT - 2] as number)).toBe(
      SD_INTERVAL,
    );
    expect((ticks[SD_PAUSE_AT] as number) - (ticks[SD_PAUSE_AT - 1] as number)).toBe(
      SD_PAUSE_TICKS,
    );
    expect((ticks[120] as number) - (ticks[119] as number)).toBe(SD_INTERVAL);
    expect(ofKind(events, EventKind.BOMB_EXPLODED)).toHaveLength(0);
    expect(s.hidden[crate]).toBe(0);
    const deaths = ofKind(events, EventKind.DEATH);
    expect(deaths.map((e) => [e.tick, e.seat])).toEqual([
      [ticks[120], 0],
      [ticks[120], 1],
    ]);
    expect(ofKind(events, EventKind.ROUND_END)[0]).toMatchObject({
      tick: ticks[120],
      value: NO_SIDE,
    });
  });

  it('without sudden death the round is drawn when time runs out', () => {
    const s = createState({
      seed: 3,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      rules: { roundSeconds: 5, suddenDeath: 'none' },
    });
    skipCountdown(s);
    const events = run(s, 300);
    expect(ofKind(events, EventKind.SUDDEN_DEATH)).toHaveLength(0);
    expect(ofKind(events, EventKind.ROUND_END)).toEqual([
      {
        tick: COUNTDOWN_TICKS + 300,
        kind: EventKind.ROUND_END,
        seat: 255,
        cell: -1,
        value: NO_SIDE,
      },
    ]);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.ROUND_OVER);
  });
});

describe('round: ghost revenge', () => {
  function ghostSetup(): SimState {
    const s = tinyArena(withSeats(openArena(), { '0': [3, 2], '1': [9, 9], '2': [9, 11] }));
    s.hdr[Hdr.RULE_FLAGS] = RuleFlag.GHOSTS;
    return s;
  }

  it('an eliminated seat haunts the nearest outer wall and glides along it', () => {
    const s = ghostSetup();
    blast(s, 0);
    expect(s.alive[0]).toBe(0);
    expect(s.ghost[0]).toBe(1);
    expect([s.px[0], s.py[0]]).toEqual([C(3), C(0)]);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
    run(s, 10, only(0, encodeInput(Dir.DOWN))); // off the ring: ignored
    expect([s.px[0], s.py[0]]).toEqual([C(3), C(0)]);
    run(s, 4, only(0, encodeInput(Dir.RIGHT)));
    expect(s.px[0]).toBe(C(3) + 64);
    run(s, 200, only(0, encodeInput(Dir.RIGHT))); // clamps at the corner
    expect([s.px[0], s.py[0]]).toEqual([C(12), C(0)]);
    run(s, 16, only(0, encodeInput(Dir.DOWN)));
    expect([s.px[0], s.py[0]]).toEqual([C(12), C(1)]);
    // The secondary direction is used when the main one does not fit the edge.
    run(s, 16, only(0, encodeInput(Dir.LEFT, Dir.DOWN)));
    expect([s.px[0], s.py[0]]).toEqual([C(12), C(2)]);
  });

  it('drops a range-1 ghost bomb on the outermost lane once per cooldown', () => {
    const s = ghostSetup();
    blast(s, 0);
    const early = run(s, GHOST_BOMB_COOLDOWN - 1, only(0, BOMB));
    expect(ofKind(early, EventKind.GHOST_BOMB)).toHaveLength(0);
    run(s, 1); // cooldown reaches zero
    const drop = step(s, only(0, BOMB));
    expect(ofKind(drop, EventKind.GHOST_BOMB)).toEqual([
      {
        tick: 2 + GHOST_BOMB_COOLDOWN,
        kind: EventKind.GHOST_BOMB,
        seat: 0,
        cell: cellIndex(3, 1),
        value: 0,
      },
    ]);
    expect(bombCount(s)).toBe(1);
    expect(s.bombRange[0]).toBe(1);
    expect(s.bombFuse[0]).toBe(GHOST_BOMB_FUSE);
    expect(s.bombFlags[0]).toBe(BombFlag.GHOST);
    expect(bombsInUse(s, 0)).toBe(0);
    expect(s.ghostCd[0]).toBe(GHOST_BOMB_COOLDOWN);
    const again = run(s, 10, only(0, BOMB));
    expect(ofKind(again, EventKind.GHOST_BOMB)).toHaveLength(0);
  });

  it('ghost bombs eliminate living seats (credited to the ghost); ghosts are immune', () => {
    const s = ghostSetup();
    blast(s, 0);
    // Walk seat 1 next to where the ghost will drop.
    s.px[1] = C(4);
    s.py[1] = C(1);
    run(s, GHOST_BOMB_COOLDOWN);
    step(s, only(0, BOMB)); // ghost bomb on (3,1)
    const events = run(s, GHOST_BOMB_FUSE + 2);
    const deaths = ofKind(events, EventKind.DEATH);
    expect(deaths.map((e) => [e.seat, e.value])).toEqual([[1, 0]]);
    expect(s.ghost[0]).toBe(1);
    expect(ofKind(events, EventKind.ROUND_END)[0]?.value).toBe(2);
  });

  it('no ghosts when the rule is off', () => {
    const s = ghostSetup();
    s.hdr[Hdr.RULE_FLAGS] = 0;
    blast(s, 0);
    expect(s.ghost[0]).toBe(0);
  });
});

describe('round: teams', () => {
  function teamSetup(friendlyFire: boolean): SimState {
    const s = tinyArena(
      withSeats(openArena(), { '0': [1, 1], '1': [11, 1], '2': [2, 1], '3': [11, 11] }),
    );
    s.team.set([0, 1, 0, 1]);
    s.hdr[Hdr.RULE_FLAGS] = RuleFlag.TEAMS | (friendlyFire ? RuleFlag.FRIENDLY_FIRE : 0);
    return s;
  }

  it("without friendly fire a teammate's flame does not hurt, one's own does", () => {
    const s = teamSetup(false);
    addBomb(s, 1, 1, 0, 1, 2); // seat 0's bomb under seats 0 and 2
    const events = run(s, 1);
    expect(ofKind(events, EventKind.DEATH).map((e) => e.seat)).toEqual([0]);
    expect(s.alive[2]).toBe(1);
  });

  it("with friendly fire a teammate's flame eliminates", () => {
    const s = teamSetup(true);
    addBomb(s, 1, 1, 0, 1, 2);
    const events = run(s, 1);
    expect(ofKind(events, EventKind.DEATH).map((e) => e.seat)).toEqual([0, 2]);
  });

  it('a team wins when the other team is out, even with one member down', () => {
    const s = teamSetup(false);
    blast(s, 0);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
    blast(s, 1, 2);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
    const events = blast(s, 3, 2);
    expect(ofKind(events, EventKind.ROUND_END)[0]?.value).toBe(0);
    expect(Array.from(s.wins)).toEqual([1, 0, 0, 0]);
    expect(s.hdr[Hdr.MATCH_WINNER]).toBe(0);
  });

  it('createState sets team mode from the seat teams', () => {
    const s = createState({
      seed: 4,
      arena: ARENA_GARDEN,
      seats: [true, true, true, true],
      teams: [0, 1, 1, 0],
    });
    expect((s.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.TEAMS).toBe(RuleFlag.TEAMS);
    expect(Array.from(s.team)).toEqual([0, 1, 1, 0]);
    expect(() =>
      createState({
        seed: 4,
        arena: ARENA_GARDEN,
        seats: [true, true, true, true],
        teams: [0, 1, 4, 0],
      }),
    ).toThrow(RangeError);
  });
});

describe('match: rounds, scoring, presets', () => {
  it('plays first-to-N: rounds restart with a fresh arena and starting stats', () => {
    const s = createState({
      seed: 5,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      rules: { winsToMatch: 3 },
    });
    const spawn1 = [s.px[1], s.py[1]];
    const layouts: string[] = [];
    const ends: SimEvent[] = [];
    for (let round = 1; round <= 3; round++) {
      expect(s.hdr[Hdr.ROUND]).toBe(round);
      layouts.push(Array.from(s.tiles).join(''));
      skipCountdown(s);
      s.bombCap[0] = 5;
      s.px[0] = C(1);
      s.py[0] = C(1);
      const events = blast(s, 1, 1);
      ends.push(...ofKind(events, EventKind.ROUND_END), ...ofKind(events, EventKind.MATCH_END));
      if (round < 3) {
        expect(s.hdr[Hdr.PHASE]).toBe(Phase.ROUND_OVER);
        run(s, ROUND_END_TICKS);
        expect(s.hdr[Hdr.PHASE]).toBe(Phase.COUNTDOWN);
        expect(s.bombCap[0]).toBe(1);
        expect(s.alive[1]).toBe(1);
        expect([s.px[1], s.py[1]]).toEqual(spawn1);
        expect(bombCount(s)).toBe(0);
      }
    }
    expect(new Set(layouts).size).toBe(3);
    expect(ends.map((e) => [e.kind, e.value])).toEqual([
      [EventKind.ROUND_END, 0],
      [EventKind.ROUND_END, 0],
      [EventKind.ROUND_END, 0],
      [EventKind.MATCH_END, 0],
    ]);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.MATCH_OVER);
    expect(s.hdr[Hdr.MATCH_WINNER]).toBe(0);
    expect(s.wins[0]).toBe(3);
    // Frozen: only the tick counter moves.
    const before = Array.from(s.bytes.subarray(8));
    expect(run(s, 50, [BOMB, BOMB, 0, 0])).toEqual([]);
    expect(Array.from(s.bytes.subarray(8))).toEqual(before);
  });

  it('drawn rounds score nothing and the match goes on', () => {
    const s = createState({
      seed: 6,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      rules: { winsToMatch: 1 },
    });
    skipCountdown(s);
    s.px[1] = C(2);
    s.py[1] = C(1);
    blast(s, 0);
    expect(s.hdr[Hdr.ROUND_WINNER]).toBe(NO_SIDE);
    expect(Array.from(s.wins)).toEqual([0, 0, 0, 0]);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.ROUND_OVER);
    run(s, ROUND_END_TICKS);
    expect(s.hdr[Hdr.ROUND]).toBe(2);
  });

  it('winsToMatch 1 ends the match with the first decided round', () => {
    const s = createState({
      seed: 7,
      arena: ARENA_GARDEN,
      seats: [true, true, false, false],
      rules: { winsToMatch: 1 },
    });
    skipCountdown(s);
    const events = blast(s, 0);
    expect(ofKind(events, EventKind.MATCH_END)[0]?.value).toBe(1);
  });

  it('presets match the PLAN', () => {
    expect(CLASSIC_RULES).toMatchObject({
      roundSeconds: 120,
      winsToMatch: 3,
      startBombs: 1,
      startRange: 2,
      powerupChance: 30,
      suddenDeath: 'spiral',
      ghosts: true,
      friendlyFire: false,
    });
    expect(CLASSIC_RULES.powerupWeights).toEqual(DEFAULT_POWERUP_WEIGHTS);
    expect(FAST_RULES).toMatchObject({ roundSeconds: 90, startBombs: 2 });
    expect(CHAOS_RULES.powerupChance).toBe(45);
    expect(CHAOS_RULES.powerupWeights[8]).toBeGreaterThan(DEFAULT_POWERUP_WEIGHTS[8] as number);
    expect(Object.keys(RULE_PRESETS)).toEqual(['classic', 'fast', 'chaos']);

    const fast = createState({
      seed: 8,
      arena: ARENA_GARDEN,
      seats: [true, true, true, true],
      rules: FAST_RULES,
    });
    expect(fast.hdr[Hdr.ROUND_TICKS]).toBe(90 * 60);
    expect(Array.from(fast.bombCap)).toEqual([2, 2, 2, 2]);
    const classic = createState({ seed: 8, arena: ARENA_GARDEN, seats: [true, true, true, true] });
    expect(classic.hdr[Hdr.RULE_FLAGS]).toBe(RuleFlag.SUDDEN_DEATH | RuleFlag.GHOSTS);
    expect(classic.hdr[Hdr.WINS_TO_MATCH]).toBe(3);
    // Rules are part of the state, so they change the hash.
    expect(stateHash(fast)).not.toBe(stateHash(classic));
  });
});
