import { describe, expect, it } from 'vitest';
import { CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import {
  BotLevel,
  EventKind,
  Hdr,
  MAX_SEATS,
  createState,
  hashHex,
  stateHash,
  step,
} from '../../../src/core';
import { MatchRunner, type MatchView } from '../../../src/game/matchRunner';
import { GAME_SPEEDS, speedFactor } from '../../../src/game/settings';
import { applyShowcase } from '../../../src/game/showcase';

const nullView: MatchView = { render: () => undefined };
const TICKS = 3000;
const FOUR_BOTS = [BotLevel.NORMAL, BotLevel.NORMAL, BotLevel.HARD, BotLevel.EXPERT];

/**
 * Plays a seeded 4-bot match in "real time" at a game speed, with irregular frame times, and
 * records the state hash after every simulated tick.
 */
function playAtSpeed(speedPercent: (typeof GAME_SPEEDS)[number]): string[] {
  const state = createState({
    seed: 21,
    arena: CLASSIC_ARENAS[2]!,
    seats: [true, true, true, true],
    bots: FOUR_BOTS,
  });
  const runner = new MatchRunner(
    state,
    (_st, out) => out.fill(0),
    nullView,
    speedFactor(speedPercent),
  );
  const hashes: string[] = [];
  runner.onTick((st) => hashes.push(hashHex(stateHash(st as typeof state))));
  // 30–144 Hz frame times, a few hitches: only the number of ticks per frame changes.
  const frames = [16.7, 8.3, 33.3, 16.7, 6.9, 50, 16.7, 11.1];
  for (let f = 0; hashes.length < TICKS; f++) runner.frame(frames[f % frames.length]!);
  return hashes.slice(0, TICKS);
}

describe('game speed (render / loop clock only)', () => {
  it('70 % and 85 % produce exactly the same states, tick for tick, as 100 %', () => {
    const full = playAtSpeed(100);
    expect(playAtSpeed(70)).toEqual(full);
    expect(playAtSpeed(85)).toEqual(full);
    // …and the same as stepping the core directly with the same bots.
    const direct = createState({
      seed: 21,
      arena: CLASSIC_ARENAS[2]!,
      seats: [true, true, true, true],
      bots: FOUR_BOTS,
    });
    const inputs = new Uint8Array(MAX_SEATS);
    for (let t = 0; t < TICKS; t++) step(direct, inputs);
    expect(full.at(-1)).toBe(hashHex(stateHash(direct)));
  });

  it('slows the real-time tick rate to 70 / 85 %', () => {
    for (const pct of GAME_SPEEDS) {
      const state = createState({ seed: 1, arena: CLASSIC_ARENAS[0]!, seats: [true, true] });
      const runner = new MatchRunner(state, (_s, out) => out.fill(0), nullView, speedFactor(pct));
      for (let f = 0; f < 600; f++) runner.frame(1000 / 60);
      expect(Math.abs((state.hdr[Hdr.TICK] as number) - 6 * pct)).toBeLessThanOrEqual(1);
    }
  });
});

describe('showcase scenes', () => {
  it('chain: six pops go off one after another', () => {
    const state = createState({
      seed: 5,
      arena: CLASSIC_ARENAS[0]!,
      seats: [true, true, true, true],
    });
    applyShowcase(state, 'chain');
    expect(state.hdr[Hdr.BOMB_COUNT]).toBe(6);
    const ticks = new Set<number>();
    let blasts = 0;
    const idle = new Uint8Array(MAX_SEATS);
    for (let t = 0; t < 80; t++) {
      for (const e of step(state, idle)) {
        if (e.kind === EventKind.BOMB_EXPLODED) {
          blasts++;
          ticks.add(e.tick);
        }
        expect(e.kind).not.toBe(EventKind.DEATH);
      }
    }
    expect(blasts).toBe(6);
    expect(ticks.size).toBeGreaterThanOrEqual(4);
  });

  it('sudden death: the spiral starts within a few ticks', () => {
    const state = createState({
      seed: 5,
      arena: CLASSIC_ARENAS[0]!,
      seats: [true, true, true, true],
    });
    applyShowcase(state, 'suddenDeath');
    const kinds: number[] = [];
    const idle = new Uint8Array(MAX_SEATS);
    for (let t = 0; t < 40; t++) for (const e of step(state, idle)) kinds.push(e.kind);
    expect(kinds).toContain(EventKind.SUDDEN_DEATH);
    expect(kinds).toContain(EventKind.BLOCK_DROPPED);
  });
});
