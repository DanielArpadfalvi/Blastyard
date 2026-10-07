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
 *  1. bot decisions (bot seats replace their input byte), Jinx input effects, movement of alive
 *     seats (a kick sets a bomb sliding)
 *  2. conveyor belts carry players, teleports (`floor.ts`); bomb pass-through release; sliding
 *     bombs advance (kicks, belts, trampoline hops)
 *  3. pickup collection, Jinx ageing / transfer
 *  4. bomb fuses and this tick's explosions (flames, chains, crates → revealed pickups)
 *  5. bomb placement or Toss (press + 6-tick buffer), gliding of ghosts, ghost revenge bombs
 *  6. bombs on burning cells are lit
 *  7. round clock, growing pillars and sudden-death blocks
 *  8. flame damage (simultaneous eliminations; a Shield absorbs the hit; eliminated seats drop
 *     power-ups)
 *  9. invulnerability, flame and pickup-grace ageing
 * 10. round-end check
 */

import { botInput } from './ai/bot';
import { botLevel } from './ai/difficulty';
import {
  decayFlames,
  lightBombsInFlames,
  releaseBombPass,
  slideBombs,
  updateBombInput,
  updateBombs,
} from './bombs';
import { EventSink, type SimEvent } from './events';
import { applyFloors, updateGrow } from './floor';
import { inputBomb } from './input';
import { endRound, startRound } from './match';
import { movePlayer } from './movement';
import { collectPickups, jinxInput, updateJinx } from './powerups';
import {
  ageInvulnerability,
  applyFlameDamage,
  roundOutcome,
  updateCountdown,
  updateGhost,
  updateRoundClock,
} from './round';
import { Hdr, MAX_SEATS, Phase, isSeatActive, type SimState } from './state';

const NO_EVENTS: readonly SimEvent[] = Object.freeze([]);

/** The inputs the simulation really uses this tick (bots, curses applied); module scratch. */
const effective = new Uint8Array(MAX_SEATS);

function playTick(state: SimState, inputs: ArrayLike<number>, sink: EventSink): void {
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s)) continue;
    let input = (inputs[s] ?? 0) & 0xff;
    if (botLevel(state, s) !== 0) input = botInput(state, s);
    if (state.alive[s]) {
      input = jinxInput(state, s, input);
      movePlayer(state, s, input, sink);
    }
    effective[s] = input;
  }
  applyFloors(state, sink);
  releaseBombPass(state);
  slideBombs(state, sink);
  collectPickups(state, sink);
  updateJinx(state, sink);
  updateBombs(state, sink);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s)) continue;
    const input = effective[s] as number;
    if (state.alive[s]) updateBombInput(state, s, inputBomb(input), sink);
    else if (state.ghost[s]) updateGhost(state, s, input, sink);
  }
  lightBombsInFlames(state);
  const timeUp = updateRoundClock(state, sink);
  updateGrow(state, sink);
  applyFlameDamage(state, sink);
  ageInvulnerability(state);
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
