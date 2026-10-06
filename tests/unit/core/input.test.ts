import { describe, expect, it } from 'vitest';
import {
  Dir,
  INPUT_BOMB,
  encodeInput,
  inputBomb,
  inputMain,
  inputSecondary,
  packInputs,
  unpackInputs,
} from '../../../src/core';

describe('input byte', () => {
  it('encodes main, secondary and bomb bits per PLAN §1.4', () => {
    const b = encodeInput(Dir.RIGHT, Dir.UP, true);
    expect(b).toBe(2 | (1 << 3) | INPUT_BOMB);
    expect(inputMain(b)).toBe(Dir.RIGHT);
    expect(inputSecondary(b)).toBe(Dir.UP);
    expect(inputBomb(b)).toBe(true);
    expect(encodeInput(Dir.NONE)).toBe(0);
    expect(b).toBeLessThan(0x80);
  });

  it('treats out-of-range direction values as none', () => {
    expect(inputMain(7)).toBe(Dir.NONE);
    expect(inputSecondary(6 << 3)).toBe(Dir.NONE);
    expect(inputBomb(0x80)).toBe(false);
  });

  it('packs four seats into one uint32 and back', () => {
    const seats = [encodeInput(Dir.UP), 0, encodeInput(Dir.LEFT, Dir.DOWN, true), 0xff];
    const packed = packInputs(seats);
    expect(packed).toBeGreaterThan(0x7fffffff); // seat 3 in the top byte, unsigned
    expect(Array.from(unpackInputs(packed, new Uint8Array(4)))).toEqual(seats);
  });
});
