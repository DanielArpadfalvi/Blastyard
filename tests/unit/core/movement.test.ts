import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  CORNER_ASSIST,
  Dir,
  MAX_SEATS,
  Tile,
  addBomb,
  bombAt,
  canPassBomb,
  createState,
  encodeInput,
  playerCell,
  cellIndex,
  removeBomb,
  step,
  tileCenter,
  toTile,
  type Direction,
  type SimState,
} from '../../../src/core';
import { ARENA_GARDEN, CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import { only, placeSeat, skipCountdown, tinyArena } from './helpers';

const C = tileCenter; // C(1) = 384, C(2) = 640, C(3) = 896 …

function hold(state: SimState, seat: number, input: number, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(state, only(seat, input));
}

function pos(state: SimState, seat = 0): [number, number] {
  return [state.px[seat] as number, state.py[seat] as number];
}

/** Row of three openings downwards (x = 1, 3, 5) separated by pillars. */
const COMB = ['#######', '#.....#', '#.o.o.#', '#.....#', '#######'];

describe('movement: straight lines and blocking', () => {
  it('moves 16 subunits per tick at base speed', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    step(s, only(0, encodeInput(Dir.RIGHT)));
    expect(pos(s)).toEqual([C(1) + BASE_SPEED, C(1)]);
    expect(s.moveDir[0]).toBe(Dir.RIGHT);
    expect(s.facing[0]).toBe(Dir.RIGHT);
  });

  it('stops at the centre of the last free tile before a wall', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    hold(s, 0, encodeInput(Dir.RIGHT), 100);
    expect(pos(s)).toEqual([C(3), C(1)]);
    expect(s.moveDir[0]).toBe(Dir.NONE);
  });

  it('is blocked by walls, pillars and crates', () => {
    const s = tinyArena(['#####', '#.o.#', '#+0.#', '#.#.#', '#####']);
    for (const dir of [Dir.UP, Dir.LEFT, Dir.DOWN] as Direction[]) {
      hold(s, 0, encodeInput(dir), 10);
      expect(pos(s), `dir ${dir}`).toEqual([C(2), C(2)]);
    }
    hold(s, 0, encodeInput(Dir.RIGHT), 3);
    expect(pos(s)).toEqual([C(2) + 3 * BASE_SPEED, C(2)]);
  });

  it('stands still without input and reverses instantly', () => {
    const s = tinyArena(['######', '#0...#', '######']);
    hold(s, 0, encodeInput(Dir.RIGHT), 5);
    hold(s, 0, 0, 5);
    expect(pos(s)[0]).toBe(C(1) + 80);
    expect(s.moveDir[0]).toBe(Dir.NONE);
    hold(s, 0, encodeInput(Dir.LEFT), 2);
    expect(pos(s)[0]).toBe(C(1) + 48);
  });

  it('applies Roller levels and caps them at 24 subunits/tick', () => {
    const s = tinyArena(['########', '#0.....#', '########']);
    s.speedLvl[0] = 2;
    step(s, only(0, encodeInput(Dir.RIGHT)));
    expect(pos(s)[0]).toBe(C(1) + 20);
    s.speedLvl[0] = 9;
    step(s, only(0, encodeInput(Dir.RIGHT)));
    expect(pos(s)[0]).toBe(C(1) + 44);
  });

  it('ignores dead and inactive seats', () => {
    const s = tinyArena(['#####', '#01.#', '#####']);
    s.alive[1] = 0;
    step(s, [0, encodeInput(Dir.RIGHT), encodeInput(Dir.RIGHT), encodeInput(Dir.RIGHT)]);
    expect(pos(s, 1)).toEqual([C(2), C(1)]);
    expect(pos(s, 2)).toEqual([0, 0]);
  });
});

describe('movement: corridor turns', () => {
  const L_CORRIDOR = ['#####', '#0..#', '###.#', '###.#', '#####'];

  it('a diagonal hold (main down, secondary right) runs the corridor to its end', () => {
    const s = tinyArena(L_CORRIDOR);
    hold(s, 0, encodeInput(Dir.DOWN, Dir.RIGHT), 200);
    expect(pos(s)).toEqual([C(3), C(3)]);
  });

  it('a turn pressed early keeps running until the opening, then turns', () => {
    const s = tinyArena(L_CORRIDOR);
    hold(s, 0, encodeInput(Dir.RIGHT), 10); // x = 544, the pillar-less wall below
    const trace: [number, number][] = [];
    for (let t = 0; t < 80; t++) {
      step(s, only(0, encodeInput(Dir.DOWN)));
      trace.push(pos(s));
    }
    expect(Math.max(...trace.map(([x]) => x))).toBe(C(3)); // never overshoots the lane
    expect(pos(s)).toEqual([C(3), C(3)]);
    // Never moved on both axes away from a centre at the same time (axis invariant).
    for (const [x, y] of trace) expect(x === C(toTile(x)) || y === C(toTile(y))).toBe(true);
  });

  it('a turn pressed with no previous motion and no secondary does nothing', () => {
    const s = tinyArena(L_CORRIDOR);
    hold(s, 0, encodeInput(Dir.DOWN), 20);
    expect(pos(s)).toEqual([C(1), C(1)]);
  });

  it('at maximum speed the early turn still catches the first opening', () => {
    const s = tinyArena(COMB);
    placeSeat(s, 0, C(2), C(1));
    s.speedLvl[0] = 4;
    s.moveDir[0] = Dir.RIGHT;
    for (let t = 0; t < 40; t++) {
      step(s, only(0, encodeInput(Dir.DOWN)));
      expect(s.px[0]).toBeLessThanOrEqual(C(3));
    }
    expect(pos(s)).toEqual([C(3), C(3)]);
  });
});

describe('movement: corner assist window edges', () => {
  function atRow1(x: number): SimState {
    const s = tinyArena(COMB);
    placeSeat(s, 0, x, C(1));
    return s;
  }

  it(`assists at exactly ${CORNER_ASSIST} subunits before the lane`, () => {
    const s = atRow1(C(3) - CORNER_ASSIST);
    step(s, only(0, encodeInput(Dir.DOWN)));
    expect(pos(s)).toEqual([C(3) - CORNER_ASSIST + BASE_SPEED, C(1)]);
    expect(s.moveDir[0]).toBe(Dir.DOWN);
  });

  it(`does not assist at ${CORNER_ASSIST + 1} subunits before the lane`, () => {
    const s = atRow1(C(3) - CORNER_ASSIST - 1);
    step(s, only(0, encodeInput(Dir.DOWN)));
    expect(pos(s)).toEqual([C(3) - CORNER_ASSIST - 1, C(1)]);
    expect(s.moveDir[0]).toBe(Dir.NONE);
  });

  it(`assists at exactly ${CORNER_ASSIST} past the lane, not at ${CORNER_ASSIST + 1}`, () => {
    const inside = atRow1(C(3) + CORNER_ASSIST);
    step(inside, only(0, encodeInput(Dir.DOWN)));
    expect(pos(inside)).toEqual([C(3) + CORNER_ASSIST - BASE_SPEED, C(1)]);

    const outside = atRow1(C(3) + CORNER_ASSIST + 1);
    step(outside, only(0, encodeInput(Dir.DOWN)));
    expect(pos(outside)).toEqual([C(3) + CORNER_ASSIST + 1, C(1)]);
  });

  it('spends leftover budget in the new direction once aligned', () => {
    const s = atRow1(C(3) - 10);
    step(s, only(0, encodeInput(Dir.DOWN)));
    expect(pos(s)).toEqual([C(3), C(1) + BASE_SPEED - 10]);
  });

  it('never assists into a blocked lane', () => {
    const s = atRow1(C(2) + 40); // pillar below tile 2
    step(s, only(0, encodeInput(Dir.DOWN)));
    expect(pos(s)).toEqual([C(2) + 40, C(1)]);
  });

  it('works on the vertical axis too', () => {
    const s = tinyArena(['#####', '#...#', '#.o.#', '#...#', '#####']);
    placeSeat(s, 0, C(1), C(3) - 50);
    step(s, only(0, encodeInput(Dir.RIGHT)));
    expect(pos(s)).toEqual([C(1), C(3) - 34]);
  });
});

describe('movement: bombs', () => {
  it('the owner may walk off its own bomb, but not back on', () => {
    const s = tinyArena(['######', '#0...#', '######']);
    expect(addBomb(s, 1, 1, 0, 150, 2)).toBe(0);
    expect(canPassBomb(s, 0, 0)).toBe(true);
    hold(s, 0, 0, 10); // standing still keeps the right to leave
    expect(canPassBomb(s, 0, 0)).toBe(true);
    hold(s, 0, encodeInput(Dir.RIGHT), 8); // x = 512: centre enters tile 2
    expect(playerCell(s, 0)).toBe(cellIndex(2, 1));
    expect(canPassBomb(s, 0, 0)).toBe(false);
    hold(s, 0, encodeInput(Dir.LEFT), 30);
    expect(pos(s)).toEqual([512, C(1)]); // cannot step back towards its own bomb
  });

  it('can walk across its bomb tile in any direction while still on it', () => {
    const s = tinyArena(['#####', '#.0.#', '#####']);
    addBomb(s, 2, 1, 0, 150, 2);
    hold(s, 0, encodeInput(Dir.LEFT), 4);
    hold(s, 0, encodeInput(Dir.RIGHT), 30);
    expect(pos(s)).toEqual([C(3), C(1)]);
  });

  it("other players' bombs are walls", () => {
    const s = tinyArena(['#######', '#0..1.#', '#######']);
    addBomb(s, 2, 1, 1, 150, 2); // seat 1 is not on tile 2
    expect(canPassBomb(s, 0, 1)).toBe(false);
    step(s, [encodeInput(Dir.RIGHT), encodeInput(Dir.LEFT), 0, 0]);
    hold(s, 0, encodeInput(Dir.RIGHT), 40);
    expect(pos(s, 0)).toEqual([C(1), C(1)]);
    for (let t = 0; t < 40; t++) step(s, [0, encodeInput(Dir.LEFT), 0, 0]);
    expect(pos(s, 1)).toEqual([C(3), C(1)]);
  });

  it('everyone standing on the tile at placement may leave it', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    placeSeat(s, 1, C(1) + 60, C(1));
    addBomb(s, 1, 1, 0, 150, 2);
    expect(canPassBomb(s, 0, 1)).toBe(true);
    for (let t = 0; t < 20; t++) step(s, [0, encodeInput(Dir.RIGHT), 0, 0]);
    expect(pos(s, 1)).toEqual([C(1) + 60 + 20 * BASE_SPEED, C(1)]);
    expect(canPassBomb(s, 0, 1)).toBe(false);
    expect(canPassBomb(s, 0, 0)).toBe(true);
  });

  it('a bomb blocks the corner assist into its lane', () => {
    const s = tinyArena(COMB);
    placeSeat(s, 0, C(3) - 20, C(1));
    addBomb(s, 3, 2, 255, 150, 2);
    step(s, only(0, encodeInput(Dir.DOWN)));
    expect(pos(s)).toEqual([C(3) - 20, C(1)]);
  });

  it('removing a bomb frees the tile and keeps creation order', () => {
    const s = tinyArena(['######', '#0...#', '######']);
    addBomb(s, 2, 1, 255, 150, 2);
    addBomb(s, 3, 1, 255, 140, 3);
    addBomb(s, 4, 1, 255, 130, 4);
    expect(addBomb(s, 3, 1, 255, 1, 1)).toBe(-1); // tile taken
    removeBomb(s, 0);
    expect(bombAt(s, 2, 1)).toBe(-1);
    expect(bombAt(s, 3, 1)).toBe(0);
    expect(bombAt(s, 4, 1)).toBe(1);
    expect(s.bombRange[0]).toBe(3);
    hold(s, 0, encodeInput(Dir.RIGHT), 40);
    expect(pos(s)).toEqual([C(2), C(1)]);
  });
});

describe('movement: invariants on real arenas', () => {
  it('players stay on floor and aligned on at least one axis under random input', () => {
    for (const arena of CLASSIC_ARENAS) {
      const s = createState({ seed: 31, arena, seats: [true, true, true, true] });
      // Open the arena up so players roam further.
      for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === Tile.CRATE) s.tiles[i] = 0;
      let lcg = 12345;
      const inputs = [0, 0, 0, 0];
      for (let t = 0; t < 2000; t++) {
        if (t % 20 === 0) {
          for (let seat = 0; seat < MAX_SEATS; seat++) {
            lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0;
            const main = ((lcg >>> 16) % 5) as Direction;
            inputs[seat] = encodeInput(main, ((lcg >>> 8) % 5) as Direction);
          }
        }
        step(s, inputs);
        for (let seat = 0; seat < MAX_SEATS; seat++) {
          const [x, y] = pos(s, seat);
          expect(x === C(toTile(x)) || y === C(toTile(y))).toBe(true);
          expect(s.tiles[playerCell(s, seat)]).toBe(Tile.FLOOR);
        }
      }
    }
  });

  it('garden spawns can walk their safe L', () => {
    const s = createState({ seed: 8, arena: ARENA_GARDEN, seats: [true, false, false, false] });
    skipCountdown(s);
    s.tiles[cellIndex(3, 1)] = Tile.CRATE;
    s.tiles[cellIndex(1, 3)] = Tile.CRATE;
    hold(s, 0, encodeInput(Dir.RIGHT), 40);
    expect(pos(s)).toEqual([C(2), C(1)]);
    hold(s, 0, encodeInput(Dir.LEFT), 40);
    hold(s, 0, encodeInput(Dir.DOWN), 40);
    expect(pos(s)).toEqual([C(1), C(2)]);
  });
});
