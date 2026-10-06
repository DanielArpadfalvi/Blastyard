/**
 * Seeded scripted "players" for golden tests and the sim bench: every seat holds a random
 * direction (with a random secondary turn intent) for 8–47 ticks, then picks a new one, and
 * presses the bomb button on about one tick in `bombOneIn`. Right after a press it runs back the
 * way it came for 60 ticks (a crude escape, so rounds last long enough to reach pickups, ghosts
 * and sudden death). Deterministic for a given seed and independent of the simulation state, so
 * a script is a pure function of (seed, tick).
 */

import { createRngWords, encodeInput, randInt, type Direction } from '../src/core';

export class ScriptedInputs {
  private readonly rng: Uint32Array;
  private readonly dir = new Uint8Array(4);
  private readonly hold = new Uint16Array(4);
  readonly current = new Uint8Array(4);

  constructor(
    seed: number,
    private readonly bombOneIn = 60,
  ) {
    this.rng = createRngWords(seed ^ 0x5eed);
  }

  /** Inputs for the next tick (also left in `current`). */
  next(): Uint8Array {
    for (let s = 0; s < 4; s++) {
      if (this.hold[s] === 0) {
        const main = randInt(this.rng, 0, 5);
        const secondary = randInt(this.rng, 0, 5);
        this.dir[s] = main | (secondary << 3);
        this.hold[s] = 8 + randInt(this.rng, 0, 40);
      }
      this.hold[s] = (this.hold[s] as number) - 1;
      const bomb = randInt(this.rng, 1, this.bombOneIn) === 0;
      if (bomb) {
        const main = (this.dir[s] as number) & 7;
        const back = main === 0 ? 1 + randInt(this.rng, 0, 4) : ((main + 1) % 4) + 1;
        this.dir[s] = back | (randInt(this.rng, 0, 5) << 3);
        this.hold[s] = 60;
      }
      const d = this.dir[s] as number;
      this.current[s] = encodeInput((d & 7) as Direction, ((d >> 3) & 7) as Direction, bomb);
    }
    return this.current;
  }
}
