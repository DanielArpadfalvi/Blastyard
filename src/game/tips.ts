/**
 * First-time help (T5.4, PLAN §1.11): whether the tutorial was finished or skipped, and which
 * contextual tips (first Kick, first Jinx, first sudden death) have been shown. Each tip shows
 * once per install. JSON through the platform key-value store; corrupt data falls back to
 * "nothing seen".
 *
 * {@link tipForEvent} maps simulation events to tips; it is pure, the session calls it.
 */

import { EventKind, Pickup, type SimEvent } from '../core';
import type { KeyValueStore } from '../platform/storage';

export const TIPS_KEY = 'blastyard.tips.v1';

export const TIP_IDS = ['kick', 'jinx', 'suddenDeath'] as const;
export type TipId = (typeof TIP_IDS)[number];

/** One-off notices outside a match (T8.1: the Blastyard+ card after the 5th finished match). */
export const NOTICE_IDS = ['plusHint'] as const;
export type NoticeId = (typeof NOTICE_IDS)[number];

/** How long a tip stays on screen (PLAN: one line, 3 s). */
export const TIP_MS = 3000;

/** The tip an event calls for, given which seats are human (null = none). */
export function tipForEvent(e: SimEvent, humans: readonly number[]): TipId | null {
  switch (e.kind) {
    case EventKind.PICKUP_COLLECTED:
      return e.value === Pickup.KICK && humans.includes(e.seat) ? 'kick' : null;
    case EventKind.BOMB_KICKED:
      return humans.includes(e.seat) ? 'kick' : null;
    case EventKind.JINX_CAUGHT:
      return humans.includes(e.seat) ? 'jinx' : null;
    case EventKind.JINX_PASSED:
      return humans.includes(e.value) ? 'jinx' : null;
    case EventKind.SUDDEN_DEATH:
      return humans.length > 0 ? 'suddenDeath' : null;
    default:
      return null;
  }
}

interface TipsSave {
  readonly tutorialDone: boolean;
  readonly shown: readonly TipId[];
  readonly notices?: readonly NoticeId[];
}

export function sanitizeTips(raw: unknown): TipsSave {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shown = Array.isArray(o.shown)
    ? TIP_IDS.filter((id) => (o.shown as unknown[]).includes(id))
    : [];
  const notices = Array.isArray(o.notices)
    ? NOTICE_IDS.filter((id) => (o.notices as unknown[]).includes(id))
    : [];
  return { tutorialDone: o.tutorialDone === true, shown, notices };
}

export class TipsStore {
  private data: TipsSave;

  constructor(private readonly store: KeyValueStore) {
    let raw: unknown;
    try {
      raw = JSON.parse(store.get(TIPS_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.data = sanitizeTips(raw);
  }

  private save(next: TipsSave): void {
    this.data = next;
    this.store.set(TIPS_KEY, JSON.stringify(next));
  }

  get tutorialDone(): boolean {
    return this.data.tutorialDone;
  }

  /** The tutorial was finished or skipped. */
  setTutorialDone(): void {
    if (!this.data.tutorialDone) this.save({ ...this.data, tutorialDone: true });
  }

  seen(id: TipId): boolean {
    return this.data.shown.includes(id);
  }

  /** Marks notice `id` as shown; true only the first time (show it then). */
  takeNotice(id: NoticeId): boolean {
    const notices = this.data.notices ?? [];
    if (notices.includes(id)) return false;
    this.save({ ...this.data, notices: [...notices, id] });
    return true;
  }

  /** Marks `id` as shown; true only the first time (show it then). */
  take(id: TipId): boolean {
    if (this.seen(id)) return false;
    this.save({ ...this.data, shown: [...this.data.shown, id] });
    return true;
  }
}
