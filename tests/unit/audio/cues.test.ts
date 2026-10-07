import { describe, expect, it } from 'vitest';
import { CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import {
  BombFlag,
  BotLevel,
  EventKind,
  GRID_W,
  Hdr,
  MAX_SEATS,
  NO_OWNER,
  NO_SIDE,
  Phase,
  addBomb,
  cellIndex,
  createState,
  step,
  type EventKindId,
  type SimEvent,
} from '../../../src/core';
import {
  CueId,
  FUSE_BEEP_TICKS,
  cueIdFor,
  cuesForEvents,
  fuseBeepCue,
  panOfCell,
  sizzleLevel,
} from '../../../src/audio/cues';
import { only, tinyArena } from '../core/helpers';

function ev(kind: EventKindId, cell = -1, value = 0, seat = NO_OWNER, tick = 10): SimEvent {
  return { tick, kind, seat, cell, value };
}

describe('sound event mapping', () => {
  it('maps every simulation event kind to its cue', () => {
    const expected: Array<[EventKindId, number, string]> = [
      [EventKind.COUNTDOWN, 3, CueId.COUNTDOWN],
      [EventKind.ROUND_START, 1, CueId.GO],
      [EventKind.BOMB_PLACED, 0, CueId.PLACE],
      [EventKind.BOMB_EXPLODED, 2, CueId.BLAST],
      [EventKind.CRATE_DESTROYED, 0, CueId.CRATE],
      [EventKind.PICKUP_COLLECTED, 2, CueId.PICKUP],
      [EventKind.PICKUP_BURNED, 1, CueId.BURN],
      [EventKind.DEATH, 1, CueId.DEATH],
      [EventKind.SUDDEN_DEATH, 0, CueId.SUDDEN_DEATH],
      [EventKind.BLOCK_DROPPED, 0, CueId.BLOCK_DROP],
      [EventKind.GHOST_BOMB, 0, CueId.GHOST_BOMB],
      [EventKind.ROUND_END, 1, CueId.ROUND_WIN],
      [EventKind.ROUND_END, NO_SIDE, CueId.ROUND_DRAW],
      [EventKind.MATCH_END, 0, CueId.MATCH_END],
      [EventKind.PICKUP_DROPPED, 4, CueId.CRATE],
      [EventKind.BOMB_TOSSED, 0, CueId.PLACE],
      [EventKind.BOMB_KICKED, 0, CueId.PLACE],
      [EventKind.SHIELD_BROKEN, 0, CueId.BURN],
      [EventKind.JINX_CAUGHT, 1, CueId.PICKUP],
      [EventKind.JINX_PASSED, 1, CueId.PICKUP],
    ];
    for (const [kind, value, cue] of expected) expect(cueIdFor(ev(kind, -1, value))).toBe(cue);
    // Every event kind is covered by the table above.
    const kinds = new Set(expected.map(([k]) => k));
    expect([...kinds].sort((a, b) => a - b)).toEqual(
      Object.values(EventKind).sort((a, b) => a - b),
    );
  });

  it('collapses a chain into one louder blast cue, centred between the pops', () => {
    const one = cuesForEvents([ev(EventKind.BOMB_EXPLODED, cellIndex(1, 5), 2)]);
    const chain = cuesForEvents([
      ev(EventKind.BOMB_EXPLODED, cellIndex(1, 5), 2),
      ev(EventKind.BOMB_EXPLODED, cellIndex(11, 5), 2),
      ev(EventKind.CRATE_DESTROYED, cellIndex(3, 4)),
      ev(EventKind.BOMB_EXPLODED, cellIndex(6, 5), 2),
    ]);
    expect(one).toHaveLength(1);
    expect(chain.map((c) => c.id)).toEqual([CueId.BLAST, CueId.CRATE]);
    expect(chain[0]!.intensity).toBeGreaterThan(one[0]!.intensity);
    expect(chain[0]!.intensity).toBeLessThanOrEqual(1);
    expect(one[0]!.pan).toBeLessThan(0);
    expect(Math.abs(chain[0]!.pan)).toBeLessThan(0.1);
  });

  it('keeps the countdown number and pickup kind as the variant', () => {
    expect(cuesForEvents([ev(EventKind.COUNTDOWN, -1, 2)])[0]).toMatchObject({ variant: 2 });
    expect(cuesForEvents([ev(EventKind.PICKUP_COLLECTED, 20, 3, 0)])[0]).toMatchObject({
      id: CueId.PICKUP,
      variant: 3,
    });
  });

  it('plays the match fanfare instead of the round jingle on the deciding round', () => {
    const cues = cuesForEvents([
      ev(EventKind.DEATH, 20, 0, 1),
      ev(EventKind.ROUND_END, -1, 0),
      ev(EventKind.MATCH_END, -1, 0),
    ]);
    expect(cues.map((c) => c.id)).toEqual([CueId.DEATH, CueId.MATCH_END]);
  });

  it('pans by column: walls ±0.6, centre 0', () => {
    expect(panOfCell(cellIndex(0, 3))).toBe(-0.6);
    expect(panOfCell(cellIndex(GRID_W - 1, 3))).toBe(0.6);
    expect(panOfCell(cellIndex(6, 9))).toBe(0);
    expect(panOfCell(-1)).toBe(0);
  });

  it('maps a whole seeded bot round without unknown events', () => {
    const state = createState({
      seed: 4,
      arena: CLASSIC_ARENAS[0]!,
      seats: [true, true, true, true],
      bots: [BotLevel.NORMAL, BotLevel.NORMAL, BotLevel.NORMAL, BotLevel.NORMAL],
    });
    const inputs = new Uint8Array(MAX_SEATS);
    const seen = new Set<string>();
    for (let t = 0; t < 4000 && state.hdr[Hdr.PHASE] !== Phase.ROUND_OVER; t++) {
      const events = step(state, inputs);
      for (const c of cuesForEvents(events)) {
        seen.add(c.id);
        expect(c.intensity).toBeGreaterThan(0);
        expect(c.intensity).toBeLessThanOrEqual(1);
        expect(Math.abs(c.pan)).toBeLessThanOrEqual(0.6);
      }
    }
    for (const id of [CueId.COUNTDOWN, CueId.GO, CueId.PLACE, CueId.BLAST]) {
      expect(seen.has(id), id).toBe(true);
    }
  });
});

describe('fuse cues', () => {
  it('beeps in the final half second at a rising pitch, once per beep tick', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    addBomb(state, 4, 1, 0, 40, 1);
    const beeps: number[] = [];
    for (let t = 0; t < 45; t++) {
      step(state, only(0, 0));
      const cue = fuseBeepCue(state);
      if (cue) {
        expect(cue.id).toBe(CueId.FUSE_BEEP);
        beeps.push(cue.variant);
      }
    }
    expect(beeps).toEqual(FUSE_BEEP_TICKS.map((_, i) => i));
    expect(Math.max(...FUSE_BEEP_TICKS)).toBe(30);
  });

  it('hisses louder with more lit pops and stays silent outside play', () => {
    const state = tinyArena(['#######', '#0....#', '#######']);
    expect(sizzleLevel(state)).toBe(0);
    addBomb(state, 3, 1, 0, 100, 1);
    const one = sizzleLevel(state);
    addBomb(state, 5, 1, 0, 100, 1, BombFlag.GHOST);
    const two = sizzleLevel(state);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThanOrEqual(1);
    state.hdr[Hdr.PHASE] = Phase.ROUND_OVER;
    expect(sizzleLevel(state)).toBe(0);
    expect(fuseBeepCue(state)).toBeNull();
  });
});
