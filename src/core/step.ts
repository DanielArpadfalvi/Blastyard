/**
 * `step(state, inputs)` – the only way to advance a match by one 60 Hz tick.
 *
 * Pure apart from mutating `state`: the result depends only on the state bytes and the four input
 * bytes (see `input.ts`), so it doubles as the rollback-netcode primitive. Seats are processed in
 * index order. Returned events carry the id of the tick that produced them, so a renderer can
 * de-duplicate events re-emitted after a rollback.
 *
 * Order within a tick: tick counter → player movement (seat 0–3) → bomb pass-through release.
 */

import { releaseBombPass } from './bombs';
import { movePlayer } from './movement';
import { Hdr, MAX_SEATS, Phase, isSeatActive, type SimState } from './state';

/** Something observable that happened during a tick (consumed by render / audio / game). */
export interface SimEvent {
  /** Tick id (value of `hdr[TICK]` after the step that produced the event). */
  readonly tick: number;
  readonly kind: number;
  readonly seat: number;
  readonly cell: number;
}

const NO_EVENTS: readonly SimEvent[] = Object.freeze([]);

/**
 * Advances `state` by one tick. `inputs[s]` is seat `s`'s input byte (missing = no input).
 * Returns the events of this tick (a shared frozen empty array when there are none).
 */
export function step(state: SimState, inputs: ArrayLike<number>): readonly SimEvent[] {
  const hdr = state.hdr;
  hdr[Hdr.TICK] = (hdr[Hdr.TICK] as number) + 1;
  if (hdr[Hdr.PHASE] === Phase.PLAYING) {
    for (let s = 0; s < MAX_SEATS; s++) {
      if (isSeatActive(state, s) && state.alive[s]) movePlayer(state, s, (inputs[s] ?? 0) & 0xff);
    }
    releaseBombPass(state);
  }
  return NO_EVENTS;
}

/** Current tick id. */
export function currentTick(state: SimState): number {
  return state.hdr[Hdr.TICK] as number;
}
