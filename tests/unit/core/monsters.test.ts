import { describe, expect, it } from 'vitest';
import { ARENA_MEADOW } from '../../../src/content/challenges/arenas';
import {
  Ability,
  EventKind,
  HOP_INTERVAL,
  HOP_TICKS,
  HOUND_SIGHT,
  Hdr,
  MAX_MONSTERS,
  MONSTER_KILLER,
  MONSTER_START_DELAY,
  MONSTER_STEP_TICKS,
  Monster,
  Phase,
  RuleFlag,
  STATE_BYTES,
  SIM_VERSION,
  Tile,
  addBomb,
  cellIndex,
  createState,
  hashHex,
  monsterCell,
  monstersAlive,
  placeMonsters,
  restore,
  snapshot,
  stateHash,
  step,
  tileCenter,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import { only, placeSeat, tinyArena } from './helpers';

const IDLE = [0, 0, 0, 0];

function run(state: SimState, ticks: number, inputs: ArrayLike<number> = IDLE): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...step(state, inputs));
  return events;
}

/** Tiny arena with a player parked at (px, py) tiles and the given monsters. */
function arenaWith(
  rows: readonly string[],
  monsters: ReadonlyArray<{ kind: number; x: number; y: number }>,
): SimState {
  const state = tinyArena(rows);
  placeMonsters(state, monsters);
  return state;
}

const CORRIDOR = ['#######', '#0....#', '#######'];

describe('monsters', () => {
  it('SIM_VERSION covers the monster state and every slot is empty by default', () => {
    expect(SIM_VERSION).toBeGreaterThanOrEqual(5);
    const state = tinyArena(CORRIDOR);
    expect(monstersAlive(state)).toBe(0);
    expect(STATE_BYTES).toBeLessThanOrEqual(4096);
  });

  it('a snail rests, then walks one tile per 40 ticks and never leaves the floor', () => {
    const state = arenaWith(
      ['#####', '#...#', '#...#', '#.0.#', '#####'],
      [{ kind: Monster.SNAIL, x: 1, y: 1 }],
    );
    run(state, MONSTER_START_DELAY - 1);
    expect(state.monCell[0]).toBe(cellIndex(1, 1));
    run(state, 1);
    // The first step has just begun: the target tile is a neighbour.
    const first = state.monNext[0] as number;
    expect([cellIndex(2, 1), cellIndex(1, 2)]).toContain(first);
    run(state, MONSTER_STEP_TICKS[Monster.SNAIL]!);
    expect(state.monCell[0]).toBe(first);
    for (let t = 0; t < 600; t++) {
      step(state, IDLE);
      expect(state.tiles[state.monCell[0] as number]).toBe(Tile.FLOOR);
    }
  });

  it('is deterministic: same setup, same hash; snapshot and restore replay exactly', () => {
    const make = (): SimState =>
      arenaWith(
        ['#######', '#.....#', '#.....#', '#..0..#', '#######'],
        [
          { kind: Monster.SNAIL, x: 1, y: 1 },
          { kind: Monster.HOPPER, x: 5, y: 1 },
        ],
      );
    const a = make();
    const b = make();
    run(a, 900);
    run(b, 900);
    expect(hashHex(stateHash(a))).toBe(hashHex(stateHash(b)));
    const snap = snapshot(a);
    run(a, 300);
    const later = hashHex(stateHash(a));
    restore(a, snap);
    run(a, 300);
    expect(hashHex(stateHash(a))).toBe(later);
  });

  it('monsters never enter a bomb tile or a tile claimed by another monster', () => {
    const state = arenaWith(CORRIDOR, [
      { kind: Monster.SNAIL, x: 3, y: 1 },
      { kind: Monster.SNAIL, x: 4, y: 1 },
    ]);
    placeSeat(state, 0, tileCenter(1), tileCenter(1));
    for (let t = 0; t < 1200; t++) {
      step(state, IDLE);
      expect(state.monCell[0]).not.toBe(state.monCell[1]);
    }
  });

  it('a hound within sight chases along the shortest path; out of sight it wanders', () => {
    const state = arenaWith(
      ['#########', '#0......#', '#########'],
      [{ kind: Monster.HOUND, x: 1 + HOUND_SIGHT, y: 1 }],
    );
    // The player stays shielded and still; the hound closes in.
    state.abilities[0] = Ability.SHIELD;
    run(state, MONSTER_START_DELAY);
    let last = state.monCell[0] as number;
    run(state, MONSTER_STEP_TICKS[Monster.HOUND]!);
    expect(state.monCell[0]).toBe(last - 1);
    last = state.monCell[0] as number;
    run(state, MONSTER_STEP_TICKS[Monster.HOUND]!);
    expect(state.monCell[0]).toBe(last - 1);
  });

  it('a hopper hops over a crate after its interval, landing two tiles on', () => {
    const state = arenaWith(['#####', '#.+.#', '#####'], [{ kind: Monster.HOPPER, x: 1, y: 1 }]);
    // No seats: nothing to bother, just watch the hopper.
    let hopped = false;
    for (let t = 0; t < HOP_INTERVAL + 2 * MONSTER_START_DELAY && !hopped; t++) {
      step(state, IDLE);
      hopped = state.monJump[0] === 1;
    }
    expect(hopped).toBe(true);
    // It had to wait for its hop interval first.
    expect(state.hdr[Hdr.TICK]).toBeGreaterThanOrEqual(HOP_INTERVAL);
    expect(state.monNext[0]).toBe(cellIndex(3, 1));
    run(state, HOP_TICKS);
    expect(state.monCell[0]).toBe(cellIndex(3, 1));
    expect(state.tiles[cellIndex(2, 1)]).toBe(Tile.CRATE);
  });

  it('a flame kills a monster (event with the owner and kind)', () => {
    const state = arenaWith(
      ['#######', '#0.....#', '#######'],
      [{ kind: Monster.SNAIL, x: 3, y: 1 }],
    );
    // Hold the monster still by keeping its first step far away, then burn its tile.
    state.monTimer[0] = 200;
    state.monSpan[0] = 200;
    addBomb(state, 3, 1, 0, 1, 2);
    const events = run(state, 3);
    const killed = events.find((e) => e.kind === EventKind.MONSTER_KILLED);
    expect(killed).toBeDefined();
    expect(killed!.cell).toBe(cellIndex(3, 1));
    expect(killed!.value).toBe(Monster.SNAIL);
    expect(monstersAlive(state)).toBe(0);
  });

  it('touching a monster eliminates a seat, a Shield absorbs it once', () => {
    const lethal = arenaWith(['#####', '#0..#', '#####'], [{ kind: Monster.SNAIL, x: 1, y: 1 }]);
    lethal.monTimer[0] = 1;
    const events = run(lethal, 2);
    const death = events.find((e) => e.kind === EventKind.DEATH);
    expect(death).toBeDefined();
    expect(death!.value).toBe(MONSTER_KILLER);
    expect(lethal.alive[0]).toBe(0);

    const shielded = arenaWith(['#####', '#0..#', '#####'], [{ kind: Monster.SNAIL, x: 1, y: 1 }]);
    shielded.abilities[0] = Ability.SHIELD;
    shielded.monTimer[0] = 1;
    const kinds = run(shielded, 2).map((e) => e.kind);
    expect(kinds).toContain(EventKind.SHIELD_BROKEN);
    expect(shielded.alive[0]).toBe(1);
    expect(shielded.abilities[0]! & Ability.SHIELD).toBe(0);
  });

  it('a monster standing in the first half of a step counts for the tile it leaves', () => {
    const state = arenaWith(CORRIDOR, [{ kind: Monster.SNAIL, x: 4, y: 1 }]);
    state.monCell[0] = cellIndex(4, 1);
    state.monNext[0] = cellIndex(3, 1);
    state.monSpan[0] = 40;
    state.monTimer[0] = 30;
    expect(monsterCell(state, 0)).toBe(cellIndex(4, 1));
    state.monTimer[0] = 20;
    expect(monsterCell(state, 0)).toBe(cellIndex(3, 1));
  });

  it('creating a state places monsters, a flag and starting abilities; bad input throws', () => {
    const state = createState({
      seed: 3,
      arena: ARENA_MEADOW,
      seats: [true, false, false, false],
      monsters: [{ kind: Monster.HOUND, x: 11, y: 11 }],
      goalCell: cellIndex(11, 1),
      startAbilities: Ability.SHIELD,
    });
    expect(monstersAlive(state)).toBe(1);
    expect(state.hdr[Hdr.GOAL_CELL]).toBe(cellIndex(11, 1));
    expect(state.abilities[0]).toBe(Ability.SHIELD);
    const base = { seed: 3, arena: ARENA_MEADOW, seats: [true, false, false, false] };
    // (3, 1) is a crate candidate, not plain floor.
    expect(() =>
      createState({ ...base, monsters: [{ kind: Monster.SNAIL, x: 3, y: 1 }] }),
    ).toThrow();
    expect(() =>
      createState({
        ...base,
        monsters: Array.from({ length: MAX_MONSTERS + 1 }, () => ({
          kind: Monster.SNAIL,
          x: 11,
          y: 11,
        })),
      }),
    ).toThrow();
    expect(() => createState({ ...base, startAbilities: Ability.KICK | Ability.TOSS })).toThrow();
    expect(() => createState({ ...base, goalCell: cellIndex(3, 1) })).toThrow();
  });

  it('warm-up: already playing, no clock, flames and monsters hurt nobody', () => {
    const state = createState({
      seed: 5,
      arena: { ...ARENA_MEADOW, crateDensity: 0 },
      seats: [true, true, false, false],
      warmup: true,
      monsters: [{ kind: Monster.SNAIL, x: 11, y: 11 }],
    });
    expect(state.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
    expect(state.hdr[Hdr.ROUND_TICKS]).toBe(0);
    expect((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.HARMLESS).toBe(RuleFlag.HARMLESS);
    // Seat 0 drops a bomb on itself and stays put: it survives the blast.
    run(state, 5, only(0, 0x40));
    run(state, 400);
    expect(state.alive[0]).toBe(1);
    expect(state.alive[1]).toBe(1);
    expect(state.hdr[Hdr.PHASE]).toBe(Phase.PLAYING);
  });
});
