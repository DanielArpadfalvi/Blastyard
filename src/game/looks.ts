/**
 * What each seat wears (T6.2 customization): Puff, hat, pop skin and trail per seat, persisted in
 * the save. Ids are checked against the catalogue on load; an item that is (no longer) unlocked –
 * e.g. a Plus item without Blastyard+ – is worn as the seat's default instead, without losing the
 * choice. Cosmetic only.
 */

import {
  HATS,
  POP_SKINS,
  PUFFS,
  TRAILS,
  defaultAppearance,
  type Appearance,
  type CosmeticItem,
} from '../content/cosmetics';
import type { KeyValueStore } from '../platform/storage';
import { isUnlocked, type ProgressContext } from './unlocks';

export const LOOKS_KEY = 'blastyard.looks.v1';
export const LOOK_SEATS = 4;

const has = (items: readonly CosmeticItem[], id: unknown): id is string =>
  typeof id === 'string' && items.some((i) => i.id === id);

function sanitizeLook(raw: unknown, seat: number): Appearance {
  const base = defaultAppearance(seat);
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    puff: has(PUFFS, o.puff) ? o.puff : base.puff,
    hat: o.hat === null ? null : has(HATS, o.hat) ? o.hat : base.hat,
    pop: has(POP_SKINS, o.pop) ? o.pop : base.pop,
    trail: o.trail === null ? null : has(TRAILS, o.trail) ? o.trail : base.trail,
  };
}

export function sanitizeLooks(raw: unknown): Appearance[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: LOOK_SEATS }, (_, s) => sanitizeLook(list[s], s));
}

/** The look a seat actually wears: locked parts fall back to the seat default. */
export function wornLook(look: Appearance, seat: number, ctx: ProgressContext): Appearance {
  const base = defaultAppearance(seat);
  const ok = (items: readonly CosmeticItem[], id: string | null): boolean => {
    if (id === null) return true;
    const item = items.find((i) => i.id === id);
    return item !== undefined && isUnlocked(item, ctx);
  };
  return {
    puff: ok(PUFFS, look.puff) ? look.puff : base.puff,
    hat: ok(HATS, look.hat) ? look.hat : base.hat,
    pop: ok(POP_SKINS, look.pop) ? look.pop : base.pop,
    trail: ok(TRAILS, look.trail) ? look.trail : base.trail,
  };
}

export class LooksStore {
  private looks: Appearance[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore) {
    let raw: unknown;
    try {
      raw = JSON.parse(store.get(LOOKS_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.looks = sanitizeLooks(raw);
  }

  get(seat: number): Appearance {
    return this.looks[seat] ?? defaultAppearance(seat);
  }

  all(): readonly Appearance[] {
    return this.looks;
  }

  set(seat: number, patch: Partial<Appearance>): void {
    if (seat < 0 || seat >= LOOK_SEATS) return;
    this.looks = this.looks.map((l, s) => (s === seat ? sanitizeLook({ ...l, ...patch }, s) : l));
    this.store.set(LOOKS_KEY, JSON.stringify(this.looks));
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
