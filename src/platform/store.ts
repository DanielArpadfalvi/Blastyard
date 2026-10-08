/**
 * Picks the store port of this build (T8.1). Native shells: RevenueCat with the platform key, or
 * "store unavailable" without one (never unlocks). The web has no store: the mock stands in for
 * the preview and tests (`?test`, `?store=mock`), otherwise the paywall says the store is
 * unavailable. `?plus` / `?supporter` pretend ownership (dev, e2e).
 */

import {
  mockEntitlements,
  type Entitlements,
  type MockEntitlements,
  type MockOutcome,
} from './entitlement';
import { isNativePlatform, nativeEntitlements } from './revenuecat';

/** `?store=`: `mock` (purchases succeed), an outcome for every purchase, or `none`. */
export type StoreChoice = 'mock' | 'none' | MockOutcome;

export interface StoreOptions {
  readonly test: boolean;
  readonly plus: boolean;
  readonly supporter: boolean;
  readonly store: StoreChoice | null;
}

const CHOICES: readonly StoreChoice[] = [
  'mock',
  'none',
  'purchased',
  'pending',
  'cancelled',
  'failed',
];

export function parseStoreChoice(raw: string | null): StoreChoice | null {
  return CHOICES.includes(raw as StoreChoice) ? (raw as StoreChoice) : null;
}

/** The web mock for these options (tests drive it through the shell's test hook). */
export function webEntitlements(o: StoreOptions): MockEntitlements {
  const choice = o.store ?? (o.test ? 'mock' : 'none');
  return mockEntitlements({
    plus: o.plus,
    supporter: o.supporter,
    available: choice !== 'none',
    outcome: choice === 'mock' || choice === 'none' ? 'purchased' : choice,
    // A short round trip, so the paywall's "waiting for the store" state is visible.
    delayMs: 250,
  });
}

export function platformEntitlements(o: StoreOptions): Entitlements {
  return isNativePlatform() && !o.test ? nativeEntitlements() : webEntitlements(o);
}
