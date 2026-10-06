/**
 * Seeded sfc32 PRNG with multiple independent named streams, integer-only.
 *
 * Every stream is four unsigned 32-bit words stored in a `Uint32Array` that lives inside the
 * simulation state (see `state.ts`), so RNG state is part of every snapshot and hash. Streams are
 * independent: drawing from one never changes another (e.g. bot decisions never shift the crate
 * layout). Outputs are identical on every platform.
 */

/** Words per stream (sfc32 a, b, c, d). */
export const RNG_WORDS = 4;

/** Named streams. Order is part of the state layout – append only. */
export const RngStream = {
  /** Arena generation: crate fill. */
  ARENA: 0,
  /** Power-ups: hidden placement, death drops, Jinx effects. */
  LOOT: 1,
  /** Round-level choices: spawn selection, ghost spots. */
  ROUND: 2,
  /** One stream per seat for in-simulation bots. */
  AI0: 3,
  AI1: 4,
  AI2: 5,
  AI3: 6,
  /** Challenge monsters. */
  MONSTER: 7,
} as const;
export type RngStreamId = (typeof RngStream)[keyof typeof RngStream];
export const RNG_STREAM_COUNT = 8;

const GOLDEN = 0x9e3779b9;
const UINT32_RANGE = 0x1_0000_0000;

/** murmur3 finalizer: a strong 32-bit integer mix. */
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Initialises `stream` in `words` from a 32-bit seed. Different streams diverge immediately. */
export function seedStream(words: Uint32Array, stream: number, seed: number): void {
  const base = stream * RNG_WORDS;
  let s = ((seed >>> 0) ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0;
  for (let i = 0; i < RNG_WORDS; i++) {
    s = (s + GOLDEN) >>> 0;
    words[base + i] = mix32(s);
  }
  // Warm up: the first outputs of a freshly seeded sfc32 are weakly mixed.
  for (let i = 0; i < 12; i++) nextU32(words, stream);
}

/** Seeds every stream from one match seed. */
export function seedAllStreams(words: Uint32Array, seed: number): void {
  for (let s = 0; s < RNG_STREAM_COUNT; s++) seedStream(words, s, seed);
}

/** sfc32 step: returns an unsigned 32-bit integer and advances the stream. */
export function nextU32(words: Uint32Array, stream: number): number {
  const base = stream * RNG_WORDS;
  const a = words[base] as number;
  const b = words[base + 1] as number;
  const c = words[base + 2] as number;
  const d = words[base + 3] as number;
  const t = (((a + b) >>> 0) + d) >>> 0;
  words[base + 3] = (d + 1) >>> 0;
  words[base] = (b ^ (b >>> 9)) >>> 0;
  words[base + 1] = (c + (c << 3)) >>> 0;
  words[base + 2] = (((c << 21) | (c >>> 11)) + t) >>> 0;
  return t;
}

/** Unbiased integer in [0, n) via rejection sampling (no floating point). `1 ≤ n ≤ 2^32`. */
export function randInt(words: Uint32Array, stream: number, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > UINT32_RANGE) {
    throw new RangeError(`randInt: invalid bound ${n}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  for (;;) {
    const x = nextU32(words, stream);
    if (x < limit) return x % n;
  }
}

/** True with probability `percent`/100 (integer percent, clamped to 0..100). */
export function randPercent(words: Uint32Array, stream: number, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return randInt(words, stream, 100) < percent;
}

/**
 * Weighted draw: returns an index `i` with probability `weights[i] / sum(weights)`.
 * Weights must be non-negative integers with a positive sum.
 */
export function randWeighted(
  words: Uint32Array,
  stream: number,
  weights: ArrayLike<number>,
): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i] as number;
  if (total <= 0) throw new RangeError('randWeighted: weights must have a positive sum');
  let r = randInt(words, stream, total);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] as number;
    if (r < w) return i;
    r -= w;
  }
  return weights.length - 1;
}

/** A standalone stream set (outside any state), e.g. for tools and tests. */
export function createRngWords(seed: number): Uint32Array {
  const words = new Uint32Array(RNG_STREAM_COUNT * RNG_WORDS);
  seedAllStreams(words, seed);
  return words;
}
