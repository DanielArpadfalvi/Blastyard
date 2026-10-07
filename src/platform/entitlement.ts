/**
 * What the player owns, behind the platform layer (CLAUDE.md: no other module talks to purchase
 * SDKs). T5.1/T5.2 only need the single `plus` flag to show lock badges and gate content; this
 * is the mock implementation – a plain flag, set from `?plus` in test / preview builds. The real
 * RevenueCat-backed port (T8.1) implements the same interface.
 */

export interface Entitlements {
  /** Does the player own Blastyard+ (extra arenas, challenge worlds 2–3)? */
  hasPlus(): boolean;
  /** Calls `fn` whenever the entitlement changes; returns the unsubscribe function. */
  subscribe(fn: (hasPlus: boolean) => void): () => void;
}

/** A mutable in-memory entitlement (mock purchases, tests, `?plus`). */
export interface MockEntitlements extends Entitlements {
  setPlus(value: boolean): void;
}

export function mockEntitlements(initialPlus = false): MockEntitlements {
  let plus = initialPlus;
  const listeners = new Set<(hasPlus: boolean) => void>();
  return {
    hasPlus: () => plus,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setPlus(value) {
      if (value === plus) return;
      plus = value;
      for (const fn of listeners) fn(plus);
    },
  };
}
