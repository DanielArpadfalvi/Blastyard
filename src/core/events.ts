/**
 * Simulation events: what happened during a tick, for render / audio / game logic.
 *
 * Events are output only – nothing in the simulation reads them back. Each carries the id of the
 * tick that produced it (`hdr[TICK]` after that step), so a renderer can de-duplicate events that
 * are re-emitted when ticks are re-simulated after a rollback.
 */

import { NO_OWNER } from './state';

export const EventKind = {
  /** 3-2-1 countdown beat; `value` = 3, 2 or 1. */
  COUNTDOWN: 1,
  /** A round starts playing; `value` = round number. */
  ROUND_START: 2,
  /** `seat` placed a bomb on `cell`. */
  BOMB_PLACED: 3,
  /** Bomb on `cell` exploded; `seat` = owner, `value` = flame range. */
  BOMB_EXPLODED: 4,
  /** Crate on `cell` destroyed; `value` = revealed `Pickup` kind (0 = none). */
  CRATE_DESTROYED: 5,
  /** `seat` collected `value` (`Pickup` kind) on `cell`. */
  PICKUP_COLLECTED: 6,
  /** Open pickup `value` on `cell` burnt by a flame. */
  PICKUP_BURNED: 7,
  /** `seat` was eliminated on `cell`; `value` = killer seat (`NO_OWNER` = sudden-death block). */
  DEATH: 8,
  /** The round timer ran out and the spiral starts. */
  SUDDEN_DEATH: 9,
  /** A sudden-death block fell on `cell`. */
  BLOCK_DROPPED: 10,
  /** Ghost `seat` dropped a revenge bomb on `cell`. */
  GHOST_BOMB: 11,
  /** Round decided; `value` = winning side, or `NO_SIDE` (-1) for a draw. */
  ROUND_END: 12,
  /** Match decided; `value` = winning side. */
  MATCH_END: 13,
  /** An eliminated seat's power-up `value` (`Pickup` kind) was scattered onto `cell`. */
  PICKUP_DROPPED: 14,
  /** `seat` threw its bomb from the tile it stood on; `cell` = landing cell, `value` = origin cell. */
  BOMB_TOSSED: 15,
  /** `seat` kicked a bomb on `cell`; `value` = slide direction. */
  BOMB_KICKED: 16,
  /** `seat`'s Shield absorbed a hit on `cell`. */
  SHIELD_BROKEN: 17,
  /** `seat` caught the Jinx curse `value` (`Jinx` effect id). */
  JINX_CAUGHT: 18,
  /** The curse jumped from `seat` to seat `value` (`cell` = the receiver's tile). */
  JINX_PASSED: 19,
  /** `seat` was teleported from `value` (cell) onto `cell` (a pad or a tunnel mouth). */
  TELEPORTED: 20,
  /** A growing pillar rose on `cell` (Rubble arena). */
  PILLAR_GROWN: 21,
} as const;
export type EventKindId = (typeof EventKind)[keyof typeof EventKind];

/** Something observable that happened during a tick (consumed by render / audio / game). */
export interface SimEvent {
  /** Tick id (value of `hdr[TICK]` after the step that produced the event). */
  readonly tick: number;
  readonly kind: EventKindId;
  /** Seat involved, `NO_OWNER` when none. */
  readonly seat: number;
  /** Cell index involved, -1 when none. */
  readonly cell: number;
  /** Kind-specific payload (see `EventKind`). */
  readonly value: number;
}

/** Collects the events of one `step`. */
export class EventSink {
  readonly list: SimEvent[] = [];
  constructor(readonly tick: number) {}

  emit(kind: EventKindId, seat: number = NO_OWNER, cell = -1, value = 0): void {
    this.list.push({ tick: this.tick, kind, seat, cell, value });
  }
}
