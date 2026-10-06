/**
 * Wall clock behind the platform layer (CLAUDE.md: the real time never reaches `src/core`).
 * The game uses it only for things that must differ between sessions, such as match seeds.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
