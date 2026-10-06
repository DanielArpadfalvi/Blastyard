/**
 * Power-up pickup and effects.
 *
 * A seat collects the open pickup on its tile (the tile containing its centre). Stat pickups
 * (PLAN §1.2) take effect at once: Extra Pop +1 capacity (max 6), Flame +1 range (max 7), Roller
 * +1 speed level (max 4, +2 subunits/tick each), Max Flame sets the range to 7. Kick, Toss, Pierce
 * and Shield only grant their ability bit here (Kick and Toss replace each other); their
 * behaviour and the Jinx curse arrive with T4.1.
 */

import { EventKind, type EventSink } from './events';
import { MAX_SPEED_LEVEL } from './movement';
import { Ability, MAX_SEATS, Pickup, isSeatActive, playerCell, type SimState } from './state';

export const MAX_BOMB_CAPACITY = 6;
export const MAX_RANGE = 7;

/** Applies pickup `kind` to `seat`. */
export function applyPickup(state: SimState, seat: number, kind: number): void {
  switch (kind) {
    case Pickup.EXTRA_POP:
      state.bombCap[seat] = Math.min((state.bombCap[seat] as number) + 1, MAX_BOMB_CAPACITY);
      break;
    case Pickup.FLAME:
      state.range[seat] = Math.min((state.range[seat] as number) + 1, MAX_RANGE);
      break;
    case Pickup.ROLLER:
      state.speedLvl[seat] = Math.min((state.speedLvl[seat] as number) + 1, MAX_SPEED_LEVEL);
      break;
    case Pickup.MAX_FLAME:
      state.range[seat] = MAX_RANGE;
      break;
    case Pickup.KICK:
      state.abilities[seat] = ((state.abilities[seat] as number) & ~Ability.TOSS) | Ability.KICK;
      break;
    case Pickup.TOSS:
      state.abilities[seat] = ((state.abilities[seat] as number) & ~Ability.KICK) | Ability.TOSS;
      break;
    case Pickup.PIERCE:
      state.abilities[seat] = (state.abilities[seat] as number) | Ability.PIERCE;
      break;
    case Pickup.SHIELD:
      state.abilities[seat] = (state.abilities[seat] as number) | Ability.SHIELD;
      break;
    default:
      // Pickup.JINX: collected (removed from the field); the curse itself is T4.1.
      break;
  }
}

/** Every alive seat (in seat order) collects the open pickup on its tile. */
export function collectPickups(state: SimState, sink: EventSink): void {
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!isSeatActive(state, s) || !state.alive[s]) continue;
    const cell = playerCell(state, s);
    const kind = state.pickup[cell] as number;
    if (kind === 0) continue;
    state.pickup[cell] = 0;
    state.pickupGrace[cell] = 0;
    applyPickup(state, s, kind);
    sink.emit(EventKind.PICKUP_COLLECTED, s, cell, kind);
  }
}
