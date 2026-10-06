import { describe, expect, it } from 'vitest';
import { ARENA_GARDEN } from '../../../src/content/arenas/classic';
import {
  Dir,
  Hdr,
  NO_SIDE,
  Phase,
  createState,
  encodeInput,
  step,
  type SimState,
} from '../../../src/core';
import { GO_TICKS, formatClock, hudKey, hudModel } from '../../../src/game/hud';

function match(): SimState {
  return createState({
    seed: 2,
    arena: ARENA_GARDEN,
    seats: [true, true, false, false],
    rules: { winsToMatch: 1 },
  });
}

const BOMB = encodeInput(Dir.NONE, Dir.NONE, true);

describe('hud model', () => {
  it('formats the round clock', () => {
    expect(formatClock(120)).toBe('2:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('counts down 3-2-1, then shows Go! and the clock', () => {
    const s = match();
    expect(hudModel(s).banner).toEqual({ kind: 'countdown', value: 3 });
    for (let i = 0; i < 61; i++) step(s, [0, 0, 0, 0]);
    expect(hudModel(s).banner).toEqual({ kind: 'countdown', value: 2 });
    while (s.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(s, [0, 0, 0, 0]);
    const m = hudModel(s);
    expect(m.banner).toEqual({ kind: 'go' });
    expect(m.seconds).toBe(120);
    expect(m.round).toBe(1);
    expect(m.winsToMatch).toBe(1);
    for (let i = 0; i < GO_TICKS; i++) step(s, [0, 0, 0, 0]);
    expect(hudModel(s).banner).toEqual({ kind: 'none' });
    // The clock rounds up: 2:00 for the whole first second.
    for (let i = GO_TICKS; i < 59; i++) step(s, [0, 0, 0, 0]);
    expect(hudModel(s).seconds).toBe(120);
    step(s, [0, 0, 0, 0]);
    expect(hudModel(s).seconds).toBe(119);
  });

  it('reports seat stats and the decided match', () => {
    const s = match();
    while (s.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(s, [0, 0, 0, 0]);
    const seat0 = hudModel(s).seats[0]!;
    expect(seat0).toMatchObject({
      active: true,
      alive: true,
      bombs: 1,
      range: 2,
      speed: 0,
      wins: 0,
    });
    expect(hudModel(s).seats[2]!.active).toBe(false);
    expect(hudModel(s).matchWinner).toBe(NO_SIDE);
    // Seat 0 sits on its own pop until it goes off: seat 1 takes the match.
    step(s, [BOMB, 0, 0, 0]);
    for (let i = 0; i < 200 && s.hdr[Hdr.PHASE] === Phase.PLAYING; i++) step(s, [0, 0, 0, 0]);
    const m = hudModel(s);
    expect(m.phase).toBe(Phase.MATCH_OVER);
    expect(m.matchWinner).toBe(1);
    expect(m.banner).toEqual({ kind: 'roundOver', winner: 1 });
    expect(m.seats[0]!.alive).toBe(false);
    expect(m.seats[1]!.wins).toBe(1);
  });

  it('key changes only when something visible changes', () => {
    const s = match();
    while (s.hdr[Hdr.PHASE] === Phase.COUNTDOWN) step(s, [0, 0, 0, 0]);
    for (let i = 0; i < 61; i++) step(s, [0, 0, 0, 0]);
    const k1 = hudKey(hudModel(s));
    for (let i = 0; i < 30; i++) step(s, [0, 0, 0, 0]);
    expect(hudKey(hudModel(s))).toBe(k1);
    for (let i = 0; i < 30; i++) step(s, [0, 0, 0, 0]);
    expect(hudKey(hudModel(s))).not.toBe(k1);
  });
});
