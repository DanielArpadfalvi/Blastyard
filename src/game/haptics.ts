/**
 * Which simulation events buzz the device (T3.3). Only events that concern a human seat count:
 * a player's own pop, pickup and elimination, and a nearby-in-time blast. At most one pulse per
 * {@link HAPTIC_MIN_GAP_TICKS}, the strongest of the tick wins.
 *
 * Pure apart from the injected platform port.
 */

import { EventKind, NO_SIDE, type SimEvent } from '../core';
import type { HapticKind, HapticsPort } from '../platform/haptics';

export const HAPTIC_MIN_GAP_TICKS = 6;

const STRENGTH: Readonly<Record<HapticKind, number>> = { light: 1, medium: 2, heavy: 3 };

function stronger(a: HapticKind | null, b: HapticKind): HapticKind {
  return a === null || STRENGTH[b] > STRENGTH[a] ? b : a;
}

/** Strongest pulse a batch of events asks for, given the seats played by humans. */
export function hapticFor(
  events: readonly SimEvent[],
  humans: readonly number[],
): HapticKind | null {
  let out: HapticKind | null = null;
  for (const e of events) {
    const own = humans.includes(e.seat);
    switch (e.kind) {
      case EventKind.BOMB_PLACED:
      case EventKind.PICKUP_COLLECTED:
        if (own) out = stronger(out, 'light');
        break;
      case EventKind.BOMB_EXPLODED:
        out = stronger(out, own ? 'medium' : 'light');
        break;
      case EventKind.DEATH:
        out = stronger(out, own ? 'heavy' : 'medium');
        break;
      case EventKind.ROUND_END:
        if (e.value !== NO_SIDE && humans.includes(e.value)) out = stronger(out, 'medium');
        break;
      default:
        break;
    }
  }
  return out;
}

/** Feeds simulation events to the platform haptics while enabled. */
export class HapticsDirector {
  private lastTick = -Infinity;

  constructor(
    private readonly port: HapticsPort,
    private readonly humans: readonly number[],
    private enabled: boolean,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  onEvents(events: readonly SimEvent[]): void {
    if (!this.enabled || events.length === 0) return;
    const tick = events[0]!.tick;
    if (tick - this.lastTick < HAPTIC_MIN_GAP_TICKS) return;
    const kind = hapticFor(events, this.humans);
    if (kind === null) return;
    this.lastTick = tick;
    this.port.pulse(kind);
  }
}
