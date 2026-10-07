import { describe, expect, it } from 'vitest';
import {
  Ability,
  DEFAULT_POWERUP_WEIGHTS,
  Dir,
  EventKind,
  FUSE_TICKS,
  HASTE_INTERVAL,
  JINX_TICKS,
  Jinx,
  MAX_DROPS,
  Pickup,
  RngStream,
  SHIELD_INVULN,
  Tile,
  addBomb,
  bombCount,
  cellIndex,
  createRngWords,
  encodeInput,
  randWeighted,
  step,
  toTile,
  type SimEvent,
  type SimState,
} from '../../../src/core';
import { only, tinyArena } from './helpers';

function run(state: SimState, ticks: number, inputs: number[] = [0, 0, 0, 0]): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...step(state, inputs));
  return events;
}

const RIGHT = encodeInput(Dir.RIGHT);
const BOMB = encodeInput(Dir.NONE, Dir.NONE, true);

describe('Kick', () => {
  it('slides a bomb until it hits an obstacle (about 8 tiles/s) and stops on a tile centre', () => {
    const s = tinyArena(['#########', '#0B.....#', '#########']);
    s.abilities[0] = Ability.KICK;
    addBomb(s, 2, 1, 3, FUSE_TICKS, 2);
    run(s, 3, only(0, RIGHT));
    expect(s.bombSlide[0]).toBe(Dir.RIGHT);
    const x0 = s.bombX[0] as number;
    run(s, 1, only(0, RIGHT));
    expect((s.bombX[0] as number) - x0).toBe(34);
    run(s, 60, only(0, RIGHT));
    expect(s.bombSlide[0]).toBe(0);
    expect(s.bombX[0]).toBe(7 * 256 + 128);
    expect(s.bombY[0]).toBe(1 * 256 + 128);
  });

  it('does nothing without the ability', () => {
    const s = tinyArena(['#######', '#0B...#', '#######']);
    addBomb(s, 2, 1, 3, FUSE_TICKS, 2);
    run(s, 40, only(0, RIGHT));
    expect(s.bombSlide[0]).toBe(0);
    expect(toTile(s.bombX[0] as number)).toBe(2);
  });

  it('stops before a player standing in the lane', () => {
    const s = tinyArena(['#########', '#0B...1.#', '#########']);
    s.abilities[0] = Ability.KICK;
    addBomb(s, 2, 1, 3, FUSE_TICKS, 2);
    run(s, 80, only(0, RIGHT));
    expect(toTile(s.bombX[0] as number)).toBe(5);
  });
});

describe('Toss', () => {
  it('throws the own bomb 3 tiles over obstacles', () => {
    const s = tinyArena(['#########', '#0oo...##', '#########']);
    s.abilities[0] = Ability.TOSS;
    s.facing[0] = Dir.RIGHT;
    run(s, 1, only(0, BOMB));
    expect(bombCount(s)).toBe(1);
    expect(toTile(s.bombX[0] as number)).toBe(1);
    const events = run(s, 1, only(0, BOMB));
    expect(toTile(s.bombX[0] as number)).toBe(4);
    expect(events.some((e) => e.kind === EventKind.BOMB_TOSSED)).toBe(true);
    expect(s.bombPass[0]).toBe(0);
  });

  it('lands closer when the far tile is not free, and never throws a foreign bomb', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    s.abilities[0] = Ability.TOSS;
    s.facing[0] = Dir.RIGHT;
    run(s, 1, only(0, BOMB));
    run(s, 1, only(0, BOMB));
    expect(toTile(s.bombX[0] as number)).toBe(3);

    const t = tinyArena(['#######', '#01..##', '#######']);
    t.abilities[1] = Ability.TOSS;
    t.facing[1] = Dir.RIGHT;
    addBomb(t, 1, 1, 0, FUSE_TICKS, 2);
    t.px[1] = t.px[0] as number;
    run(t, 1, only(1, BOMB));
    expect(toTile(t.bombX[0] as number)).toBe(1);
  });
});

describe('Pierce', () => {
  const rows = ['#########', '#0++....#', '#########'];
  it('burns every crate within range and carries on behind them', () => {
    const s = tinyArena(rows);
    s.abilities[0] = Ability.PIERCE;
    s.range[0] = 4;
    run(s, 1, only(0, BOMB));
    // Step out of the way (the bomb is at the left end) – nothing to do but wait for the blast.
    let flameBehind = 0;
    for (let t = 0; t < FUSE_TICKS + 2; t++) {
      step(s, [0, 0, 0, 0]);
      flameBehind = Math.max(flameBehind, s.flame[cellIndex(5, 1)] as number);
    }
    expect(s.tiles[cellIndex(2, 1)]).toBe(Tile.FLOOR);
    expect(s.tiles[cellIndex(3, 1)]).toBe(Tile.FLOOR);
    expect(flameBehind).toBeGreaterThan(0);
  });

  it('without it the first crate stops the blast', () => {
    const s = tinyArena(rows);
    s.range[0] = 4;
    run(s, 1, only(0, BOMB));
    run(s, FUSE_TICKS + 2);
    expect(s.tiles[cellIndex(2, 1)]).toBe(Tile.FLOOR);
    expect(s.tiles[cellIndex(3, 1)]).toBe(Tile.CRATE);
  });
});

describe('Shield', () => {
  it('absorbs one hit, then 60 ticks of invulnerability', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    s.abilities[0] = Ability.SHIELD;
    s.flame[cellIndex(1, 1)] = 200;
    const events = run(s, 1);
    expect(s.alive[0]).toBe(1);
    expect(s.abilities[0] & Ability.SHIELD).toBe(0);
    expect(s.invuln[0]).toBe(SHIELD_INVULN - 1);
    expect(events.some((e) => e.kind === EventKind.SHIELD_BROKEN)).toBe(true);
    run(s, SHIELD_INVULN - 2);
    expect(s.alive[0]).toBe(1);
    run(s, 3);
    expect(s.alive[0]).toBe(0);
  });
});

describe('Jinx', () => {
  const curse = (s: SimState, seat: number, effect: number): void => {
    s.jinx[seat] = effect;
    s.jinxTicks[seat] = JINX_TICKS;
  };

  it('reversed: the directions are inverted', () => {
    const s = tinyArena(['#######', '#..0..#', '#######']);
    curse(s, 0, Jinx.REVERSED);
    run(s, 10, only(0, RIGHT));
    expect(s.px[0] as number).toBeLessThan(3 * 256 + 128);
  });

  it('slow: half speed', () => {
    const s = tinyArena(['#######', '#0....#', '#######']);
    const x0 = s.px[0] as number;
    curse(s, 0, Jinx.SLOW);
    run(s, 10, only(0, RIGHT));
    expect((s.px[0] as number) - x0).toBe(80);
  });

  it('haste: bombs are placed without pressing', () => {
    const s = tinyArena(['#######', '#0....#', '#######']);
    s.bombCap[0] = 6;
    curse(s, 0, Jinx.HASTE);
    run(s, HASTE_INTERVAL * 2, only(0, RIGHT));
    expect(bombCount(s)).toBeGreaterThan(0);
  });

  it('bomb ban: presses do nothing', () => {
    const s = tinyArena(['#######', '#0....#', '#######']);
    curse(s, 0, Jinx.NO_BOMB);
    run(s, 20, only(0, BOMB));
    expect(bombCount(s)).toBe(0);
  });

  it('lasts 10 s and then ends', () => {
    const s = tinyArena(['#####', '#0..#', '#####']);
    curse(s, 0, Jinx.SLOW);
    run(s, JINX_TICKS - 1);
    expect(s.jinx[0]).toBe(Jinx.SLOW);
    run(s, 1);
    expect(s.jinx[0]).toBe(Jinx.NONE);
  });

  it('is drawn from the pickup and passes on touch without ping-pong', () => {
    const s = tinyArena(['#######', '#01...#', '#######']);
    s.pickup[cellIndex(1, 1)] = Pickup.JINX;
    const events = run(s, 1);
    expect(s.jinx[0]).not.toBe(0);
    expect(events.some((e) => e.kind === EventKind.JINX_CAUGHT)).toBe(true);
    s.px[1] = (s.px[0] as number) + 100;
    run(s, 2);
    expect(s.jinx[0]).toBe(0);
    expect(s.jinx[1]).not.toBe(0);
    run(s, 30);
    expect(s.jinx[0]).toBe(0);
    expect(s.jinx[1]).not.toBe(0);
  });
});

describe('death drops', () => {
  function victim(collected: number): SimState {
    const s = tinyArena([
      '###########',
      '#0........#',
      '#.........#',
      '#.........#',
      '###########',
    ]);
    s.bombCap[0] = 1 + collected;
    s.flame[cellIndex(1, 1)] = 5;
    return s;
  }
  const pickups = (s: SimState): number =>
    Array.from(s.pickup).filter((p) => p !== Pickup.NONE).length;

  it('scatters at most 4 of the collected power-ups', () => {
    const s = victim(5);
    const events = run(s, 1);
    expect(s.alive[0]).toBe(0);
    expect(pickups(s)).toBe(MAX_DROPS);
    expect(events.filter((e) => e.kind === EventKind.PICKUP_DROPPED)).toHaveLength(MAX_DROPS);
  });

  it('drops all of a small haul, deterministically from the loot stream', () => {
    const a = victim(2);
    const b = victim(2);
    run(a, 1);
    run(b, 1);
    expect(pickups(a)).toBe(2);
    expect(Array.from(a.pickup)).toEqual(Array.from(b.pickup));
    const none = victim(0);
    run(none, 1);
    expect(pickups(none)).toBe(0);
  });
});

describe('power-up weights (PLAN 1.2)', () => {
  it('10 000 seeded draws match the table within 1.5 percentage points', () => {
    const words = createRngWords(12345);
    const counts = new Array(DEFAULT_POWERUP_WEIGHTS.length).fill(0) as number[];
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      counts[randWeighted(words, RngStream.LOOT, DEFAULT_POWERUP_WEIGHTS)]!++;
    }
    const total = DEFAULT_POWERUP_WEIGHTS.reduce((a, b) => a + b, 0);
    DEFAULT_POWERUP_WEIGHTS.forEach((w, k) => {
      expect(Math.abs((counts[k]! / n) * 100 - (w / total) * 100)).toBeLessThanOrEqual(1.5);
    });
    expect(DEFAULT_POWERUP_WEIGHTS).toEqual([26, 26, 16, 8, 6, 5, 5, 3, 5]);
  });
});
