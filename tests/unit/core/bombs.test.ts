import { describe, expect, it } from 'vitest';
import {
  Ability,
  BOMB_BUFFER_TICKS,
  CHAIN_DELAY,
  Dir,
  EventKind,
  FLAME_TICKS,
  FUSE_TICKS,
  Hdr,
  MAX_BOMB_CAPACITY,
  MAX_RANGE,
  NO_SIDE,
  PICKUP_GRACE,
  Phase,
  Pickup,
  Tile,
  addBomb,
  applyPickup,
  bombAt,
  bombCount,
  cellIndex,
  encodeInput,
  step,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import { only, tinyArena } from './helpers';

const BOMB = encodeInput(Dir.NONE, Dir.NONE, true);
const IDLE = [0, 0, 0, 0];

/** Steps `ticks` times with `inputs`, returning every event. */
function run(state: SimState, ticks: number, inputs: readonly number[] = IDLE): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...step(state, inputs));
  return events;
}

function ofKind(events: readonly SimEvent[], kind: number): SimEvent[] {
  return events.filter((e) => e.kind === kind);
}

const cell = cellIndex;

describe('bombs: placement', () => {
  it('places a bomb on the seat tile with the PLAN fuse and the seat range', () => {
    const s = tinyArena(['########', '#0.....#', '########']);
    const events = step(s, only(0, BOMB));
    expect(bombCount(s)).toBe(1);
    expect(bombAt(s, 1, 1)).toBe(0);
    expect(s.bombFuse[0]).toBe(FUSE_TICKS);
    expect(s.bombOwner[0]).toBe(0);
    expect(s.bombRange[0]).toBe(2);
    expect(events).toEqual([
      { tick: 1, kind: EventKind.BOMB_PLACED, seat: 0, cell: cell(1, 1), value: 0 },
    ]);
  });

  it('respects capacity and never stacks two bombs on one tile', () => {
    const s = tinyArena(['########', '#0.....#', '########']);
    step(s, only(0, BOMB));
    step(s, only(0, BOMB)); // same tile: refused
    expect(bombCount(s)).toBe(1);
    run(s, 16, only(0, encodeInput(Dir.RIGHT))); // one tile to the right
    expect(s.px[0]).toBe(2 * 256 + 128);
    step(s, only(0, BOMB)); // capacity 1 reached
    expect(bombCount(s)).toBe(1);
    run(s, BOMB_BUFFER_TICKS + 1); // let the buffer run out
    s.bombCap[0] = 2;
    step(s, only(0, BOMB));
    expect(bombCount(s)).toBe(2);
    expect(bombAt(s, 2, 1)).toBe(1);
  });

  it(`buffers a press for ${BOMB_BUFFER_TICKS} ticks until capacity frees up`, () => {
    for (const fuse of [BOMB_BUFFER_TICKS + 1, BOMB_BUFFER_TICKS + 2]) {
      const s = tinyArena(['############', '#0.........#', '############']);
      addBomb(s, 9, 1, 0, fuse, 1); // own bomb far away – explodes on tick `fuse`
      const events = [...step(s, only(0, BOMB)), ...run(s, 20)];
      const placed = ofKind(events, EventKind.BOMB_PLACED);
      if (fuse - 1 <= BOMB_BUFFER_TICKS) {
        expect(placed).toHaveLength(1);
        expect(placed[0]?.tick).toBe(fuse); // capacity freed by the explosion in the same tick
        expect(bombAt(s, 1, 1)).toBe(0);
      } else {
        expect(placed).toHaveLength(0);
      }
    }
  });

  it('the placed bomb blocks everybody once its owner has walked off', () => {
    const s = tinyArena(['#####', '#0.1#', '#####']);
    step(s, only(0, BOMB));
    run(s, 16, only(0, encodeInput(Dir.RIGHT)));
    expect(s.px[0]).toBe(2 * 256 + 128); // left the bomb tile
    run(s, 20, [encodeInput(Dir.LEFT), encodeInput(Dir.LEFT), 0, 0]);
    expect(s.px[0]).toBe(2 * 256 + 128); // the owner cannot go back
    expect(s.px[1]).toBe(2 * 256 + 128); // nor can anybody else
  });
});

describe('bombs: fuse and flames', () => {
  it(`explodes exactly ${FUSE_TICKS} ticks after placement`, () => {
    const s = tinyArena(['##########', '#0.......#', '##########']);
    step(s, only(0, BOMB)); // tick 1
    run(s, 64, only(0, encodeInput(Dir.RIGHT))); // walk 4 tiles away (range 2)
    const before = run(s, FUSE_TICKS - 1 - 64);
    expect(ofKind(before, EventKind.BOMB_EXPLODED)).toHaveLength(0);
    expect(bombCount(s)).toBe(1);
    const events = step(s, IDLE);
    expect(ofKind(events, EventKind.BOMB_EXPLODED)).toEqual([
      { tick: 1 + FUSE_TICKS, kind: EventKind.BOMB_EXPLODED, seat: 0, cell: cell(1, 1), value: 2 },
    ]);
    expect(bombCount(s)).toBe(0);
    expect(s.alive[0]).toBe(1);
  });

  it('spreads a cross: stops at walls and pillars, destroys only the first crate', () => {
    const s = tinyArena([
      '#########',
      '#.......#',
      '#...+...#',
      '#...+...#',
      '#.o.....#',
      '#.......#',
      '#.......#',
      '#.......#',
      '#########',
    ]);
    addBomb(s, 4, 4, 0, 1, 4);
    const events = step(s, IDLE);
    const burning = (x: number, y: number) => (s.flame[cell(x, y)] as number) > 0;
    // Right / down: range 4, cut short by the outer wall.
    for (const x of [4, 5, 6, 7]) expect(burning(x, 4), `(${x},4)`).toBe(true);
    for (const y of [5, 6, 7]) expect(burning(4, y), `(4,${y})`).toBe(true);
    // Left: one cell, then the pillar stops the arm.
    expect(burning(3, 4)).toBe(true);
    expect(burning(2, 4)).toBe(false);
    expect(burning(1, 4)).toBe(false);
    expect(s.tiles[cell(2, 4)]).toBe(Tile.PILLAR);
    // Up: the first crate absorbs the arm (no flame on its cell), the second survives.
    expect(s.tiles[cell(4, 3)]).toBe(Tile.FLOOR);
    expect(burning(4, 3)).toBe(false);
    expect(s.tiles[cell(4, 2)]).toBe(Tile.CRATE);
    expect(ofKind(events, EventKind.CRATE_DESTROYED)).toEqual([
      { tick: 1, kind: EventKind.CRATE_DESTROYED, seat: 255, cell: cell(4, 3), value: 0 },
    ]);
    expect(s.flameOwner[cell(5, 4)]).toBe(0);
  });

  it(`keeps a flame lethal for exactly ${FLAME_TICKS} ticks`, () => {
    const s = tinyArena(['#######', '#.....#', '#######']);
    addBomb(s, 1, 1, 3, 1, 1);
    step(s, IDLE); // explosion tick
    expect(s.flame[cell(2, 1)]).toBe(FLAME_TICKS - 1);
    run(s, FLAME_TICKS - 2);
    expect(s.flame[cell(2, 1)]).toBe(1); // still lethal during the next tick
    step(s, IDLE);
    expect(s.flame[cell(2, 1)]).toBe(0);
    expect(s.flameOwner[cell(2, 1)]).toBe(255);
  });

  it('a seat walking into a lingering flame is eliminated', () => {
    const s = tinyArena(['#######', '#....0#', '#######']);
    addBomb(s, 1, 1, 0, 1, 2);
    step(s, IDLE);
    expect(s.alive[0]).toBe(1);
    const events = run(s, 28, only(0, encodeInput(Dir.LEFT))); // enters (3,1) on tick 26
    expect(s.alive[0]).toBe(0);
    const deaths = ofKind(events, EventKind.DEATH);
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.value).toBe(0); // killed by its own (earlier) bomb
    expect(deaths[0]?.cell).toBe(cell(3, 1));
  });

  it('two blasts reaching the same crate in one tick both stop there', () => {
    const s = tinyArena(['#########', '#...+...#', '#########']);
    addBomb(s, 2, 1, 0, 1, 3);
    addBomb(s, 6, 1, 1, 1, 3);
    const events = step(s, IDLE);
    expect(ofKind(events, EventKind.CRATE_DESTROYED)).toHaveLength(1);
    expect(s.tiles[cell(4, 1)]).toBe(Tile.FLOOR);
    expect(s.flame[cell(4, 1)]).toBe(0);
    expect(s.flame[cell(3, 1)]).toBeGreaterThan(0);
    expect(s.flame[cell(5, 1)]).toBeGreaterThan(0);
  });
});

describe('bombs: chains', () => {
  it(`a flame lights the next bomb, which explodes ${CHAIN_DELAY} ticks later (multi-bomb domino)`, () => {
    const s = tinyArena(['###########', '#.........#', '###########']);
    addBomb(s, 1, 1, 0, 1, 2);
    addBomb(s, 3, 1, 1, FUSE_TICKS, 2);
    addBomb(s, 5, 1, 2, FUSE_TICKS, 2);
    addBomb(s, 7, 1, 3, FUSE_TICKS, 2);
    const events = run(s, 20);
    const blasts = ofKind(events, EventKind.BOMB_EXPLODED);
    expect(blasts.map((e) => [e.tick, e.cell])).toEqual([
      [1, cell(1, 1)],
      [1 + CHAIN_DELAY, cell(3, 1)],
      [1 + 2 * CHAIN_DELAY, cell(5, 1)],
      [1 + 3 * CHAIN_DELAY, cell(7, 1)],
    ]);
    expect(bombCount(s)).toBe(0);
    expect(s.flameOwner[cell(9, 1)]).toBe(3);
  });

  it('a lit bomb with a shorter fuse keeps it; the arm stops on the lit bomb', () => {
    const s = tinyArena(['###########', '#.........#', '###########']);
    addBomb(s, 1, 1, 0, 1, 5);
    addBomb(s, 3, 1, 1, 2, 1);
    addBomb(s, 5, 1, 2, 2, 1);
    const first = step(s, IDLE);
    expect(ofKind(first, EventKind.BOMB_EXPLODED)).toHaveLength(1);
    expect(s.flame[cell(4, 1)]).toBe(0); // stopped on (3,1)
    const second = step(s, IDLE);
    expect(ofKind(second, EventKind.BOMB_EXPLODED).map((e) => e.cell)).toEqual([
      cell(3, 1),
      cell(5, 1),
    ]);
  });

  it('several bombs exploding in the same tick resolve in creation order', () => {
    const s = tinyArena(['#########', '#.......#', '#########']);
    addBomb(s, 5, 1, 1, 1, 1);
    addBomb(s, 2, 1, 0, 1, 1);
    const events = step(s, IDLE);
    expect(ofKind(events, EventKind.BOMB_EXPLODED).map((e) => e.seat)).toEqual([1, 0]);
  });

  it('a bomb dropped into a lingering flame is lit', () => {
    const s = tinyArena(['#######', '#.....#', '#######']);
    s.flame[cell(3, 1)] = 10;
    s.flameOwner[cell(3, 1)] = 2;
    addBomb(s, 3, 1, 1, FUSE_TICKS, 1);
    const events = run(s, 10);
    expect(ofKind(events, EventKind.BOMB_EXPLODED).map((e) => e.tick)).toEqual([1 + CHAIN_DELAY]);
  });
});

describe('bombs: deaths', () => {
  it('seats caught by the same blast die in the same tick → drawn round', () => {
    const s = tinyArena(['#######', '#0.1..#', '#######']);
    addBomb(s, 2, 1, 1, 1, 2);
    const events = step(s, IDLE);
    const deaths = ofKind(events, EventKind.DEATH);
    expect(deaths.map((e) => [e.tick, e.seat, e.value])).toEqual([
      [1, 0, 1],
      [1, 1, 1],
    ]);
    expect(s.alive[0]).toBe(0);
    expect(s.alive[1]).toBe(0);
    expect(ofKind(events, EventKind.ROUND_END)[0]?.value).toBe(NO_SIDE);
    expect(s.hdr[Hdr.PHASE]).toBe(Phase.ROUND_OVER);
    expect(Array.from(s.wins)).toEqual([0, 0, 0, 0]);
  });

  it('seats hit by different blasts in the same tick also die together', () => {
    const s = tinyArena(['###########', '#0.......1#', '###########']);
    addBomb(s, 2, 1, 1, 1, 1);
    addBomb(s, 8, 1, 0, 1, 1);
    const events = step(s, IDLE);
    expect(ofKind(events, EventKind.DEATH).map((e) => e.tick)).toEqual([1, 1]);
    expect(s.hdr[Hdr.ROUND_WINNER]).toBe(NO_SIDE);
  });

  it('the last seat standing wins the round', () => {
    const s = tinyArena(['#######', '#0..1.#', '#######']);
    addBomb(s, 1, 1, 0, 1, 1);
    const events = step(s, IDLE);
    expect(ofKind(events, EventKind.DEATH).map((e) => e.seat)).toEqual([0]);
    expect(ofKind(events, EventKind.ROUND_END)[0]?.value).toBe(1);
    expect(s.wins[1]).toBe(1);
  });
});

describe('bombs: pickups', () => {
  it('reveals the hidden pickup of a destroyed crate, protected by a grace period', () => {
    const s = tinyArena(['########', '#.+....#', '########']);
    const crate = cell(2, 1);
    s.hidden[crate] = Pickup.FLAME;
    addBomb(s, 1, 1, 0, 1, 1); // tick 1: destroys the crate
    addBomb(s, 3, 1, 1, 5, 1); // tick 5: flame over the fresh pickup (chain-like follow-up)
    addBomb(s, 5, 1, 2, PICKUP_GRACE, 3); // last protected tick: reaches (2,1)
    const first = step(s, IDLE);
    expect(ofKind(first, EventKind.CRATE_DESTROYED)[0]?.value).toBe(Pickup.FLAME);
    expect(s.pickup[crate]).toBe(Pickup.FLAME);
    expect(s.hidden[crate]).toBe(0);
    const during = run(s, PICKUP_GRACE - 1); // ticks 2 … 30
    expect(ofKind(during, EventKind.BOMB_EXPLODED).map((e) => e.tick)).toEqual([5, PICKUP_GRACE]);
    expect(ofKind(during, EventKind.PICKUP_BURNED)).toHaveLength(0);
    expect(s.pickup[crate]).toBe(Pickup.FLAME);
    // Grace over; the lingering flame on the cell does not burn it – only a fresh blast does.
    expect(s.flame[crate]).toBeGreaterThan(0);
    run(s, 5);
    expect(s.pickup[crate]).toBe(Pickup.FLAME);
    addBomb(s, 4, 1, 0, 1, 2);
    const burn = step(s, IDLE);
    expect(ofKind(burn, EventKind.PICKUP_BURNED)).toEqual([
      { tick: 36, kind: EventKind.PICKUP_BURNED, seat: 255, cell: crate, value: Pickup.FLAME },
    ]);
    expect(s.pickup[crate]).toBe(0);
  });

  it('flames pass over an open pickup after burning it', () => {
    const s = tinyArena(['#######', '#.....#', '#######']);
    s.pickup[cell(2, 1)] = Pickup.ROLLER;
    addBomb(s, 1, 1, 0, 1, 3);
    step(s, IDLE);
    expect(s.pickup[cell(2, 1)]).toBe(0);
    expect(s.flame[cell(4, 1)]).toBeGreaterThan(0);
  });

  it('Extra Pop, Flame and Roller raise the stats up to their caps', () => {
    const s = tinyArena(['########', '#0.....#', '########']);
    s.pickup[cell(2, 1)] = Pickup.EXTRA_POP;
    s.pickup[cell(3, 1)] = Pickup.FLAME;
    s.pickup[cell(4, 1)] = Pickup.ROLLER;
    const events = run(s, 40, only(0, encodeInput(Dir.RIGHT)));
    expect(
      ofKind(events, EventKind.PICKUP_COLLECTED).map((e) => [e.seat, e.cell, e.value]),
    ).toEqual([
      [0, cell(2, 1), Pickup.EXTRA_POP],
      [0, cell(3, 1), Pickup.FLAME],
      [0, cell(4, 1), Pickup.ROLLER],
    ]);
    expect(s.bombCap[0]).toBe(2);
    expect(s.range[0]).toBe(3);
    expect(s.speedLvl[0]).toBe(1);
    expect(s.pickup[cell(2, 1)]).toBe(0);

    s.bombCap[0] = MAX_BOMB_CAPACITY;
    s.range[0] = MAX_RANGE;
    s.speedLvl[0] = 4;
    s.pickup[cell(5, 1)] = Pickup.EXTRA_POP;
    s.pickup[cell(6, 1)] = Pickup.FLAME;
    run(s, 40, only(0, encodeInput(Dir.RIGHT)));
    expect(s.bombCap[0]).toBe(MAX_BOMB_CAPACITY);
    expect(s.range[0]).toBe(MAX_RANGE);
  });

  it('a seat collects a pickup the moment its centre enters the tile', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    s.pickup[cell(2, 1)] = Pickup.EXTRA_POP;
    run(s, 7, only(0, encodeInput(Dir.RIGHT))); // 384 + 112 = 496 < 512
    expect(s.pickup[cell(2, 1)]).toBe(Pickup.EXTRA_POP);
    step(s, only(0, encodeInput(Dir.RIGHT))); // 512: centre on tile 2
    expect(s.pickup[cell(2, 1)]).toBe(0);
    expect(s.bombCap[0]).toBe(2);
  });
});

describe('pickups: other kinds (ability bits)', () => {
  it('Max Flame maxes the range; Kick and Toss replace each other; Jinx starts a curse', () => {
    const s = tinyArena(['####', '#0.#', '####']);
    applyPickup(s, 0, Pickup.MAX_FLAME);
    expect(s.range[0]).toBe(MAX_RANGE);
    applyPickup(s, 0, Pickup.KICK);
    expect(s.abilities[0]).toBe(Ability.KICK);
    applyPickup(s, 0, Pickup.TOSS);
    expect(s.abilities[0]).toBe(Ability.TOSS);
    applyPickup(s, 0, Pickup.PIERCE);
    applyPickup(s, 0, Pickup.SHIELD);
    expect(s.abilities[0]).toBe(Ability.TOSS | Ability.PIERCE | Ability.SHIELD);
    applyPickup(s, 0, Pickup.KICK);
    expect(s.abilities[0]).toBe(Ability.KICK | Ability.PIERCE | Ability.SHIELD);
    s.pickup[cell(2, 1)] = Pickup.JINX;
    run(s, 16, only(0, encodeInput(Dir.RIGHT)));
    expect(s.pickup[cell(2, 1)]).toBe(0);
    expect(s.jinx[0]).not.toBe(0);
    expect(s.jinxTicks[0]).toBeGreaterThan(0);
  });
});
