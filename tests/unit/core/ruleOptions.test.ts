import { describe, expect, it } from 'vitest';
import {
  CORNER_ASSIST,
  CORNER_ASSIST_HIGH,
  CORNER_ASSIST_LOW,
  DEFAULT_RULES,
  Dir,
  Hdr,
  RuleFlag,
  addBomb,
  cornerAssist,
  createState,
  encodeInput,
  step,
  tileCenter,
} from '../../../src/core';
import { ARENA_GARDEN } from '../../../src/content/arenas/classic';
import { only, placeSeat, tinyArena } from './helpers';

const C = tileCenter;
const COMB = ['#######', '#.....#', '#.o.o.#', '#.....#', '#######'];

describe('friendly rule (no self damage)', () => {
  function sitOnOwnBomb(flags: number) {
    const s = tinyArena(['#####', '#0.1#', '#####']);
    s.hdr[Hdr.RULE_FLAGS] = flags;
    addBomb(s, 1, 1, 0, 1, 2); // seat 0's pop under seat 0, explodes next tick, reaches seat 1
    step(s, [0, 0, 0, 0]);
    step(s, [0, 0, 0, 0]);
    return s;
  }

  it('own flames knock you out by default', () => {
    const s = sitOnOwnBomb(0);
    expect(s.alive[0]).toBe(0);
    expect(s.alive[1]).toBe(0);
  });

  it('with the friendly rule your own flames spare you, others still get hit', () => {
    const s = sitOnOwnBomb(RuleFlag.NO_SELF_DAMAGE);
    expect(s.alive[0]).toBe(1);
    expect(s.alive[1]).toBe(0);
  });
});

describe('corner-assist strength', () => {
  function turnAt(offset: number, flags: number): number {
    const s = tinyArena(COMB);
    s.hdr[Hdr.RULE_FLAGS] = flags;
    placeSeat(s, 0, C(3) - offset, C(1));
    step(s, only(0, encodeInput(Dir.DOWN)));
    return s.moveDir[0] as number;
  }

  it('the window follows the setting', () => {
    expect(turnAt(CORNER_ASSIST, 0)).toBe(Dir.DOWN);
    expect(turnAt(CORNER_ASSIST_LOW, RuleFlag.ASSIST_LOW)).toBe(Dir.DOWN);
    expect(turnAt(CORNER_ASSIST_LOW + 1, RuleFlag.ASSIST_LOW)).toBe(Dir.NONE);
    expect(turnAt(CORNER_ASSIST + 1, 0)).toBe(Dir.NONE);
    expect(turnAt(CORNER_ASSIST_HIGH, RuleFlag.ASSIST_HIGH)).toBe(Dir.DOWN);
    expect(turnAt(CORNER_ASSIST_HIGH + 1, RuleFlag.ASSIST_HIGH)).toBe(Dir.NONE);
  });

  it('rules map to flags; defaults leave the header untouched', () => {
    const base = { seed: 1, arena: ARENA_GARDEN, seats: [true, true, false, false] };
    const plain = createState({ ...base, rules: DEFAULT_RULES });
    expect(plain.hdr[Hdr.RULE_FLAGS]! & (RuleFlag.NO_SELF_DAMAGE | RuleFlag.ASSIST_LOW)).toBe(0);
    expect(cornerAssist(plain)).toBe(CORNER_ASSIST);
    const tuned = createState({
      ...base,
      rules: { ...DEFAULT_RULES, selfDamage: false, cornerAssist: 'high' },
    });
    expect(tuned.hdr[Hdr.RULE_FLAGS]! & RuleFlag.NO_SELF_DAMAGE).toBeTruthy();
    expect(cornerAssist(tuned)).toBe(CORNER_ASSIST_HIGH);
  });
});
