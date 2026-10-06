import { describe, expect, it } from 'vitest';
import {
  RNG_STREAM_COUNT,
  RngStream,
  createRngWords,
  hashBytes,
  hashHex,
  nextU32,
  randInt,
  randPercent,
  randWeighted,
} from '../../../src/core';

describe('rng (sfc32 streams)', () => {
  it('is deterministic for a seed', () => {
    const a = createRngWords(1234);
    const b = createRngWords(1234);
    const seqA = Array.from({ length: 20 }, () => nextU32(a, RngStream.ARENA));
    const seqB = Array.from({ length: 20 }, () => nextU32(b, RngStream.ARENA));
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('differs between seeds and between streams', () => {
    const a = createRngWords(1);
    const b = createRngWords(2);
    expect(nextU32(a, 0)).not.toBe(nextU32(b, 0));
    const firsts = new Set<number>();
    const c = createRngWords(7);
    for (let s = 0; s < RNG_STREAM_COUNT; s++) firsts.add(nextU32(c, s));
    expect(firsts.size).toBe(RNG_STREAM_COUNT);
  });

  it('keeps streams independent', () => {
    const a = createRngWords(99);
    const b = createRngWords(99);
    for (let i = 0; i < 50; i++) nextU32(a, RngStream.AI0); // drain another stream
    expect(nextU32(a, RngStream.ARENA)).toBe(nextU32(b, RngStream.ARENA));
  });

  it('randInt stays in range and covers it uniformly', () => {
    const w = createRngWords(5);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const v = randInt(w, 0, 6);
      counts[v] = (counts[v] as number) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
    expect(() => randInt(w, 0, 0)).toThrow(RangeError);
    expect(() => randInt(w, 0, 1.5)).toThrow(RangeError);
    expect(randInt(w, 0, 1)).toBe(0);
  });

  it('randPercent handles the extremes', () => {
    const w = createRngWords(3);
    expect(randPercent(w, 0, 0)).toBe(false);
    expect(randPercent(w, 0, 100)).toBe(true);
  });

  it('randWeighted follows the weights', () => {
    const w = createRngWords(11);
    const weights = [26, 26, 16, 8, 6, 5, 5, 3, 5];
    const counts = new Array<number>(weights.length).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const k = randWeighted(w, RngStream.LOOT, weights);
      counts[k] = (counts[k] as number) + 1;
    }
    weights.forEach((wt, k) => {
      expect(Math.abs((counts[k] as number) / n - wt / 100)).toBeLessThan(0.01);
    });
    expect(randWeighted(w, 0, [0, 0, 4])).toBe(2);
    expect(() => randWeighted(w, 0, [0, 0])).toThrow(RangeError);
  });
});

describe('hash (FNV-1a)', () => {
  it('matches the reference vectors', () => {
    expect(hashBytes([])).toBe(0x811c9dc5);
    expect(hashHex(hashBytes([0x61]))).toBe('e40c292c'); // "a"
    expect(hashHex(hashBytes([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]))).toBe('bf9cf968'); // "foobar"
  });
});
