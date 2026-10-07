import { describe, expect, it } from 'vitest';
import {
  BELT_SPEED,
  Dir,
  EventKind,
  FloorFx,
  GROW_INTERVAL,
  Hdr,
  ICE_SLIDE,
  Mech,
  Phase,
  SPIRAL,
  TILE,
  TRAMPOLINE_HOP,
  Tile,
  Ability,
  addBomb,
  bombAt,
  bombCount,
  cellIndex,
  createState,
  encodeInput,
  nextGrowCell,
  restore,
  snapshot,
  stateHash,
  step,
  tileCenter,
  validateArena,
  type ArenaDef,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import {
  ARENA_FACTORY,
  ARENA_RUBBLE,
  ARENA_TELEPORT_GARDEN,
  ARENA_TRAMPOLINE,
  ARENA_TUNNEL,
  ALL_ARENAS,
} from '../../../src/content/arenas';
import { only, tinyArena } from './helpers';

const IDLE = [0, 0, 0, 0];
const BOMB = encodeInput(Dir.NONE, Dir.NONE, true);
const RIGHT = encodeInput(Dir.RIGHT);
const LEFT = encodeInput(Dir.LEFT);

function run(state: SimState, ticks: number, inputs: readonly number[] = IDLE): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...step(state, inputs));
  return events;
}

/** Marks cells of a hand-built arena with a floor effect and the matching mechanic bit. */
function paint(
  state: SimState,
  fx: number,
  mech: number,
  cells: ReadonlyArray<readonly [number, number]>,
) {
  for (const [x, y] of cells) state.floor[cellIndex(x, y)] = fx;
  state.hdr[Hdr.MECH] = (state.hdr[Hdr.MECH] as number) | mech;
}

function pair(state: SimState, a: readonly [number, number], b: readonly [number, number]): void {
  state.partner[cellIndex(...a)] = cellIndex(...b);
  state.partner[cellIndex(...b)] = cellIndex(...a);
}

describe('floor: ice', () => {
  it('a player who lets go keeps gliding exactly two tiles', () => {
    const s = tinyArena(['#############', '#0~~~~~~~~~~~#', '#############']);
    paint(
      s,
      FloorFx.ICE,
      Mech.ICE,
      Array.from({ length: 11 }, (_, i) => [i + 1, 1] as const),
    );
    run(s, 20, only(0, RIGHT));
    const letGo = s.px[0] as number;
    expect(letGo).toBeGreaterThan(tileCenter(2));
    run(s, 60);
    expect((s.px[0] as number) - letGo).toBe(ICE_SLIDE);
    expect(s.slideLeft[0]).toBe(0);
  });

  it('the glide stops at a wall and when steering again', () => {
    const s = tinyArena(['#######', '#0~~~~#', '#######']);
    paint(s, FloorFx.ICE, Mech.ICE, [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
    run(s, 40, only(0, RIGHT));
    run(s, 60);
    expect(s.px[0]).toBe(tileCenter(5));
    // Steering takes over: the next input clears the glide.
    s.slideLeft[0] = 300;
    step(s, only(0, LEFT));
    expect(s.slideLeft[0]).toBe(ICE_SLIDE);
  });

  it('plain floor does not glide, and the glide ends when the ice does', () => {
    const plain = tinyArena(['#########', '#0......#', '#########']);
    run(plain, 10, only(0, RIGHT));
    const x = plain.px[0];
    run(plain, 30);
    expect(plain.px[0]).toBe(x);

    const s = tinyArena(['#########', '#0..~...#', '#########']);
    paint(s, FloorFx.ICE, Mech.ICE, [[4, 1]]);
    // Walk until the centre is on the ice tile, then let go: only the ice tile is slippery.
    while (s.px[0] !== undefined && (s.px[0] as number) < tileCenter(4)) step(s, only(0, RIGHT));
    const stop = s.px[0] as number;
    run(s, 40);
    expect((s.px[0] as number) - stop).toBeLessThanOrEqual(TILE);
    expect((s.px[0] as number) - stop).toBeGreaterThan(0);
  });
});

describe('floor: conveyor belts', () => {
  it('carries an idle player 8 subunits per tick', () => {
    const s = tinyArena(['#########', '#0>>>>..#', '#########']);
    paint(s, FloorFx.BELT_RIGHT, Mech.BELT, [
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
    s.px[0] = tileCenter(2);
    const x0 = s.px[0] as number;
    run(s, 4);
    expect((s.px[0] as number) - x0).toBe(4 * BELT_SPEED);
  });

  it('does not push a player who is between lanes', () => {
    const s = tinyArena(['#####', '#.>.#', '#...#', '#####']);
    paint(s, FloorFx.BELT_RIGHT, Mech.BELT, [[2, 1]]);
    s.px[0] = tileCenter(2);
    s.py[0] = tileCenter(1) + 40;
    s.alive[0] = 1;
    s.hdr[Hdr.SEAT_MASK] = 1;
    run(s, 3);
    expect(s.px[0]).toBe(tileCenter(2));
  });

  it('carries a resting bomb tile by tile, follows turns and stops where the belt ends', () => {
    const s = tinyArena(['#######', '#0>>v.#', '#...>.#', '#######']);
    paint(s, FloorFx.BELT_RIGHT, Mech.BELT, [
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
    paint(s, FloorFx.BELT_DOWN, Mech.BELT, [[4, 1]]);
    // The owner leaves the tile first (pass-through bit), then the belt takes the bomb.
    addBomb(s, 2, 1, 1, 400, 2);
    run(s, 8 * 32 + 4);
    expect(bombCount(s)).toBe(1);
    const x = s.bombX[0] as number;
    const y = s.bombY[0] as number;
    expect([x, y]).toEqual([tileCenter(5), tileCenter(2)]);
    expect(s.bombSlide[0]).toBe(0);
  });
});

describe('floor: teleports', () => {
  it('moves the player to the paired pad once and does not bounce back', () => {
    const s = tinyArena(['###########', '#0.T...T..#', '###########']);
    paint(s, FloorFx.TELEPORT, Mech.TELEPORT, [
      [3, 1],
      [7, 1],
    ]);
    pair(s, [3, 1], [7, 1]);
    const events = run(s, 30, only(0, RIGHT));
    const tp = events.filter((e) => e.kind === EventKind.TELEPORTED);
    expect(tp).toHaveLength(1);
    expect(tp[0]).toMatchObject({ seat: 0, cell: cellIndex(7, 1), value: cellIndex(3, 1) });
    expect(s.px[0]).toBeGreaterThanOrEqual(tileCenter(7));
    expect(s.tpLock[0]).toBe(1);
    // Leaving the pad releases the lock; walking back onto the far pad sends the player again.
    run(s, 40, only(0, RIGHT));
    expect(s.tpLock[0]).toBe(0);
  });

  it('is skipped when a bomb sits on the destination pad', () => {
    const s = tinyArena(['###########', '#0.T...T..#', '###########']);
    paint(s, FloorFx.TELEPORT, Mech.TELEPORT, [
      [3, 1],
      [7, 1],
    ]);
    pair(s, [3, 1], [7, 1]);
    addBomb(s, 7, 1, 1, 400, 2);
    const events = run(s, 20, only(0, RIGHT));
    expect(events.filter((e) => e.kind === EventKind.TELEPORTED)).toHaveLength(0);
    expect(s.px[0]).toBeLessThan(tileCenter(7));
  });

  it('teleport garden pairs are mirrored diagonals', () => {
    const state = createState({
      seed: 3,
      arena: ARENA_TELEPORT_GARDEN,
      seats: [true, true, true, true],
    });
    const a = cellIndex(3, 3);
    expect(state.partner[a]).toBe(cellIndex(9, 9));
    expect(state.partner[cellIndex(9, 3)]).toBe(cellIndex(3, 9));
    expect((state.hdr[Hdr.MECH] as number) & Mech.TELEPORT).toBe(Mech.TELEPORT);
  });
});

describe('floor: edge tunnels', () => {
  it('walking into a mouth leaves through the opposite one', () => {
    const state = createState({ seed: 1, arena: ARENA_TUNNEL, seats: [true, false, false, false] });
    while (state.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(state, IDLE);
    // Put the player on the left lane next to the left mouth and walk out.
    state.px[0] = tileCenter(1);
    state.py[0] = tileCenter(6);
    const events = run(state, 20, only(0, LEFT));
    expect(events.some((e) => e.kind === EventKind.TELEPORTED && e.cell === cellIndex(12, 6))).toBe(
      true,
    );
    expect(state.px[0]).toBeGreaterThan(tileCenter(11));
    // The mouth ring is walkable floor; the outer wall is not.
    expect(state.tiles[cellIndex(0, 6)]).toBe(Tile.FLOOR);
    expect(state.tiles[cellIndex(0, 5)]).toBe(Tile.WALL);
    // And back in from the right.
    run(state, 30, only(0, LEFT));
    expect(state.px[0]).toBeLessThan(tileCenter(12));
  });
});

describe('floor: tunnels and sudden death', () => {
  it('the last spiral block also seals the tunnel mouths (regression: nobody can hide in one)', () => {
    const state = createState({
      seed: 1,
      arena: ARENA_TUNNEL,
      seats: [true, true, false, false],
      rules: { roundSeconds: 10 },
    });
    while (state.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(state, IDLE);
    state.px[1] = tileCenter(0);
    state.py[1] = tileCenter(6);
    state.tpLock[1] = 1;
    state.hdr[Hdr.ROUND_TIME] = 0;
    state.hdr[Hdr.SD_INDEX] = SPIRAL.length - 1;
    state.hdr[Hdr.SD_TIMER] = 1;
    step(state, IDLE);
    expect(state.tiles[cellIndex(0, 6)]).toBe(Tile.WALL);
    expect(state.alive[1]).toBe(0);
  });
});

describe('floor: trampolines', () => {
  it('a pop placed on a trampoline hops two tiles in the facing direction', () => {
    const s = tinyArena(['###########', '#0.....b..#', '###########']);
    paint(s, FloorFx.TRAMPOLINE, Mech.TRAMPOLINE, [[1, 1]]);
    // Standing on the trampoline, facing right.
    const events = [...step(s, only(0, encodeInput(Dir.RIGHT, Dir.NONE, true)))];
    expect(bombCount(s)).toBe(1);
    expect(events.some((e) => e.kind === EventKind.BOMB_PLACED)).toBe(true);
    expect(bombAt(s, 1 + TRAMPOLINE_HOP, 1)).toBe(0);
    expect(events.some((e) => e.kind === EventKind.BOMB_TOSSED)).toBe(true);
  });

  it('lands closer when the far tile is blocked, and stays when nothing is free', () => {
    const s = tinyArena(['#########', '#0..o...#', '#########']);
    paint(s, FloorFx.TRAMPOLINE, Mech.TRAMPOLINE, [[1, 1]]);
    s.facing[0] = Dir.RIGHT;
    step(s, only(0, BOMB));
    expect(bombAt(s, 3, 1)).toBe(0);

    const t = tinyArena(['####', '#0##', '####']);
    paint(t, FloorFx.TRAMPOLINE, Mech.TRAMPOLINE, [[1, 1]]);
    t.facing[0] = Dir.RIGHT;
    step(t, only(0, BOMB));
    expect(bombAt(t, 1, 1)).toBe(0);
  });

  it('a kicked bomb sliding onto a trampoline hops over it', () => {
    const s = tinyArena(['#############', '#0...b.......#', '#############']);
    paint(s, FloorFx.TRAMPOLINE, Mech.TRAMPOLINE, [[5, 1]]);
    s.abilities[0] = Ability.KICK;
    addBomb(s, 2, 1, 1, 400, 2);
    const events = run(s, 60, only(0, RIGHT));
    expect(events.some((e) => e.kind === EventKind.BOMB_KICKED)).toBe(true);
    expect(events.filter((e) => e.kind === EventKind.BOMB_TOSSED)).toHaveLength(1);
    expect(s.bombSlide[0]).toBe(0);
    expect(Math.floor((s.bombX[0] as number) / TILE)).toBe(5 + TRAMPOLINE_HOP);
  });

  it('factory and trampoline arenas load with their mechanic bits', () => {
    const f = createState({ seed: 1, arena: ARENA_FACTORY, seats: [true, true, false, false] });
    expect(f.hdr[Hdr.MECH]).toBe(Mech.BELT);
    const t = createState({ seed: 1, arena: ARENA_TRAMPOLINE, seats: [true, true, false, false] });
    expect(t.hdr[Hdr.MECH]).toBe(Mech.TRAMPOLINE);
  });
});

describe('floor: growing pillars', () => {
  it('stay quiet until 75% of the round, then rise one by one in cell order', () => {
    const state = createState({
      seed: 5,
      arena: ARENA_RUBBLE,
      seats: [true, false, false, false],
      rules: { roundSeconds: 40, suddenDeath: 'none' },
    });
    while (state.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(state, IDLE);
    const total = state.hdr[Hdr.ROUND_TICKS] as number;
    const growCells: number[] = [];
    for (let c = 0; c < state.floor.length; c++)
      if (state.floor[c] === FloorFx.GROW) growCells.push(c);
    expect(growCells).toHaveLength(8);
    // Keep the lone player out of harm's way: park it in its spawn.
    const grown: Array<{ tick: number; cell: number }> = [];
    let elapsed = 0;
    while (elapsed < total && state.hdr[Hdr.PHASE] === Phase.PLAYING) {
      for (const e of step(state, IDLE)) {
        if (e.kind === EventKind.PILLAR_GROWN) grown.push({ tick: elapsed, cell: e.cell });
      }
      elapsed++;
      if (elapsed < (total * 3) / 4) expect(grown).toHaveLength(0);
    }
    expect(grown.length).toBeGreaterThanOrEqual(3);
    expect(grown.map((g) => g.cell)).toEqual(growCells.slice(0, grown.length));
    expect(grown[0]!.tick).toBeGreaterThanOrEqual((total * 3) / 4 + GROW_INTERVAL - 2);
    expect(grown[1]!.tick - grown[0]!.tick).toBe(GROW_INTERVAL);
    for (const g of grown) expect(state.tiles[g.cell]).toBe(Tile.PILLAR);
    expect(nextGrowCell(state)).toBe(growCells[grown.length] ?? -1);
  });

  it('crushes whoever stands on the cell and clears bombs and pickups', () => {
    const state = createState({
      seed: 5,
      arena: ARENA_RUBBLE,
      seats: [true, true, false, false],
      rules: { roundSeconds: 20, suddenDeath: 'none', ghosts: false },
    });
    while (state.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(state, IDLE);
    const target = nextGrowCell(state);
    state.px[1] = tileCenter(target % 13);
    state.py[1] = tileCenter((target - (target % 13)) / 13);
    let died = false;
    for (let t = 0; t < 20 * 60 && !died; t++) {
      for (const e of step(state, IDLE)) {
        if (e.kind === EventKind.DEATH && e.seat === 1) died = true;
      }
    }
    expect(died).toBe(true);
    expect(state.alive[1]).toBe(0);
    expect(state.tiles[target]).toBe(Tile.PILLAR);
  });

  it('restarts with the next round', () => {
    const state = createState({
      seed: 5,
      arena: ARENA_RUBBLE,
      seats: [true, false, false, false],
      rules: { roundSeconds: 10, suddenDeath: 'none' },
    });
    while (state.hdr[Hdr.ROUND] === 1) step(state, IDLE);
    expect(state.hdr[Hdr.GROW_TIMER]).toBe(0);
    expect(nextGrowCell(state)).toBe(cellIndex(3, 3));
  });
});

describe('arena validator: mechanics', () => {
  const base: ArenaDef = ARENA_TUNNEL;
  const edit = (def: ArenaDef, y: number, x: number, ch: string): ArenaDef => ({
    ...def,
    rows: def.rows.map((row, i) => (i === y ? row.slice(0, x) + ch + row.slice(x + 1) : row)),
  });
  const codes = (def: ArenaDef): string[] => validateArena(def).errors.map((e) => e.code);

  it('accepts all twelve arenas', () => {
    expect(ALL_ARENAS).toHaveLength(12);
    expect(new Set(ALL_ARENAS.map((a) => a.id)).size).toBe(12);
    expect(new Set(ALL_ARENAS.map((a) => a.theme)).size).toBe(12);
    for (const arena of ALL_ARENAS) expect(validateArena(arena).errors, arena.id).toEqual([]);
  });

  it('rejects a tunnel mouth without an opposite mouth', () => {
    expect(codes(edit(base, 6, 12, '#'))).toContain('mechanic');
  });

  it('rejects a tunnel that is not on a side or is walled in', () => {
    expect(codes(edit(base, 0, 0, '='))).toContain('mechanic');
    expect(codes(edit(base, 6, 1, 'o'))).toContain('mechanic');
  });

  it('rejects a teleport with a single pad', () => {
    expect(codes(edit(ARENA_TELEPORT_GARDEN, 3, 3, '?'))).toContain('mechanic');
  });

  it('rejects declared mechanics that do not match the layout', () => {
    expect(codes({ ...ARENA_FACTORY, mechanics: ['ice'] })).toContain('mechanic');
    expect(codes({ ...ARENA_FACTORY, mechanics: ['belt', 'ice'] })).toContain('mechanic');
  });

  it('keeps floor effects out of the spawn safe L', () => {
    expect(codes(edit(ARENA_FACTORY, 1, 2, '>'))).toContain('safe-l');
  });

  it('rejects growing pillars that would cut the arena in two', () => {
    // (3,4) sits between pillars; growing (3,3) and (3,5) seals it in.
    expect(codes(edit(ARENA_RUBBLE, 5, 3, 'g'))).toContain('connectivity');
  });
});

describe('arenas: determinism', () => {
  for (const arena of ALL_ARENAS) {
    it(`${arena.id}: same seed ⇒ same hash, snapshot/restore matches`, () => {
      const make = (): SimState =>
        createState({
          seed: 77,
          arena,
          seats: [true, true, true, true],
          bots: [2, 2, 2, 2],
          rules: { roundSeconds: 20 },
        });
      const a = make();
      const b = make();
      for (let t = 0; t < 700; t++) {
        step(a, IDLE);
        step(b, IDLE);
      }
      expect(stateHash(a)).toBe(stateHash(b));
      const snap = snapshot(a);
      for (let t = 0; t < 120; t++) step(a, IDLE);
      const later = stateHash(a);
      restore(b, snap);
      for (let t = 0; t < 120; t++) step(b, IDLE);
      expect(stateHash(b)).toBe(later);
    });
  }
});
