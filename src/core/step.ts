/**
 * `step(state, inputs)` – the only way to advance a match by one 60 Hz tick.
 *
 * Pure apart from mutating `state`: the result depends only on the state bytes and the four input
 * bytes (see `input.ts`), so it doubles as the rollback-netcode primitive. Seats are processed in
 * index order, bombs in creation order. Returned events carry the id of the tick that produced
 * them, so a renderer can de-duplicate events re-emitted after a rollback.
 *
 * Phases: COUNTDOWN (3-2-1, nothing moves) → PLAYING → ROUND_OVER (flames fade, then the next
 * round's countdown) → … → MATCH_OVER (frozen).
 *
 * Order within a PLAYING tick:
 *  1. movement of alive seats, gliding of ghosts (seat 0–3)
 *  2. bomb pass-through release
 *  3. pickup collection
 *  4. bomb fuses and this tick's explosions (flames, chains, crates → revealed pickups)
 *  5. bomb placement (press + 6-tick buffer), ghost revenge bombs
 *  6. bombs on burning cells are lit
 *  7. round clock and sudden-death blocks
 *  8. flame damage (simultaneous eliminations)
 *  9. flame / pickup-grace ageing
 * 10. round-end check
 */

import {
  decayFlames,
  lightBombsInFlames,
  releaseBombPass,
  updateBombInput,
  updateBombs,
} from './bombs';
import { EventSink, type SimEvent } from './events';
import { inputBomb } from './input';
import { endRound, startRound } from './match';
import { movePlayer } from './movement';
import { collectPickups } from './powerups';
import {
  applyFlameDamage,
  roundOutcome,
  updateCountdown,
  updateGhost,
  updateRoundClock,
} from './round';
import { Hdr, MAX_SEATS, Phase, isSeatActive, type SimState } from './state';

const NO_EVENTS: readonly SimEvent[] = Object.freeze([]);

function playTick(state: SimState, inputs: ArrayLike<number>, sink: EventSink): void {
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s)) continue;
    const input = (inputs[s] ?? 0) & 0xff;
    if (state.alive[s]) movePlayer(state, s, input);
  }
  releaseBombPass(state);
  collectPickups(state, sink);
  updateBombs(state, sink);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s)) continue;
    const input = (inputs[s] ?? 0) & 0xff;
    if (state.alive[s]) updateBombInput(state, s, inputBomb(input), sink);
    else if (state.ghost[s]) updateGhost(state, s, input, sink);
  }
  lightBombsInFlames(state);
  const timeUp = updateRoundClock(state, sink);
  applyFlameDamage(state, sink);
  decayFlames(state);
  const outcome = roundOutcome(state, timeUp);
  if (outcome !== undefined) endRound(state, outcome, sink);
}

/**
 * Advances `state` by one tick. `inputs[s]` is seat `s`'s input byte (missing = no input).
 * Returns the events of this tick (a shared frozen empty array when there are none).
 */
export function step(state: SimState, inputs: ArrayLike<number>): readonly SimEvent[] {
  const hdr = state.hdr;
  const tick = (hdr[Hdr.TICK] as number) + 1;
  hdr[Hdr.TICK] = tick;
  const sink = new EventSink(tick);
  switch (hdr[Hdr.PHASE]) {
    case Phase.PLAYING:
      playTick(state, inputs, sink);
      break;
    case Phase.COUNTDOWN:
      updateCountdown(state, sink);
      break;
    case Phase.ROUND_OVER: {
      decayFlames(state);
      const left = (hdr[Hdr.PHASE_TIMER] as number) - 1;
      hdr[Hdr.PHASE_TIMER] = left;
      if (left <= 0) startRound(state);
      break;
    }
    default:
      break;
  }
  return sink.list.length > 0 ? sink.list : NO_EVENTS;
}

/** Current tick id. */
export function currentTick(state: SimState): number {
  return state.hdr[Hdr.TICK] as number;
}
