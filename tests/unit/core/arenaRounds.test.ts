import { describe, expect, it } from 'vitest';
import { Hdr, Phase, createState, step } from '../../../src/core';
import { ALL_ARENAS } from '../../../src/content/arenas';

/**
 * Smoke version of `npm run bot:league -- --arenas`: four Normal bots play one short round on
 * every arena and the round must be decided (a winner, or the closing spiral's draw) - no arena
 * lets a round hang. The full 100-rounds-per-arena league runs from the script.
 */
describe('every arena ends its rounds', () => {
  for (const arena of ALL_ARENAS) {
    it(`${arena.id}: four bots finish a 15 s round`, { timeout: 30_000 }, () => {
      const state = createState({
        seed: 4242,
        arena,
        seats: [true, true, true, true],
        bots: [2, 2, 2, 2],
        rules: { winsToMatch: 1, roundSeconds: 15 },
      });
      const idle = new Uint8Array(4);
      let phase: number = state.hdr[Hdr.PHASE] as number;
      for (let t = 0; t < 6000 && phase !== Phase.ROUND_OVER && phase !== Phase.MATCH_OVER; t++) {
        step(state, idle);
        phase = state.hdr[Hdr.PHASE] as number;
      }
      expect([Phase.ROUND_OVER, Phase.MATCH_OVER]).toContain(phase);
    });
  }
});
