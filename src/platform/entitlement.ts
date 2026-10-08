/**
 * What the player owns and the store behind it (T8.1, PLAN §2), behind the platform layer
 * (CLAUDE.md: no other module talks to purchase SDKs). Two non-consumables:
 *
 * - `blastyard_plus` → entitlement `plus`: 6 extra arenas, challenge worlds 2–3, custom rules,
 *   +4 Puffs / +6 hats / +3 pop skins / 1 trail;
 * - `blastyard_supporter` → entitlement `supporter`: a gold crown, a confetti trail, a thank-you.
 *
 * Implementations: {@link mockEntitlements} (web, tests, `?test` / `?store=mock` / `?plus`), and
 * the RevenueCat port in `revenuecat.ts` (native). A native build without a RevenueCat key gets
 * {@link unavailableEntitlements}: "store unavailable", never unlocks anything.
 */

export const PRODUCT_PLUS = 'blastyard_plus';
export const PRODUCT_SUPPORTER = 'blastyard_supporter';
export type ProductId = typeof PRODUCT_PLUS | typeof PRODUCT_SUPPORTER;
export const PRODUCT_IDS: readonly ProductId[] = [PRODUCT_PLUS, PRODUCT_SUPPORTER];

/** RevenueCat entitlement identifiers. */
export const ENTITLEMENT_PLUS = 'plus';
export const ENTITLEMENT_SUPPORTER = 'supporter';

export interface StoreProduct {
  readonly id: ProductId;
  /** Localised price from the store, e.g. "2,99 €". */
  readonly price: string;
}

/**
 * `purchased`: owned now; `pending`: the store accepted the order but the payment is not through
 * yet (the entitlement unlocks by itself when it is); `cancelled`: the player backed out;
 * `failed`: the store reported an error; `unavailable`: no store in this build / region.
 */
export type BuyResult = 'purchased' | 'pending' | 'cancelled' | 'failed' | 'unavailable';

/** `restored`: something is owned now; `nothing`: no purchase found; `unavailable`: no store. */
export type RestoreResult = 'restored' | 'nothing' | 'unavailable';

export interface Owned {
  readonly plus: boolean;
  readonly supporter: boolean;
}

export interface Entitlements {
  /** Does the player own Blastyard+ (extra arenas, challenge worlds 2–3, custom rules…)? */
  hasPlus(): boolean;
  /** Does the player own the Supporter pack (cosmetic only)? */
  hasSupporter(): boolean;
  /** Calls `fn` whenever an entitlement changes; returns the unsubscribe function. */
  subscribe(fn: (hasPlus: boolean) => void): () => void;
  /** The products with their store prices; `null` when there is no store. */
  products(): Promise<readonly StoreProduct[] | null>;
  buy(id: ProductId): Promise<BuyResult>;
  /** Restore purchases (settings / paywall): what the store reported. */
  restore(): Promise<RestoreResult>;
}

/** Fan-out of entitlement changes, shared by the implementations. */
export function ownedState(initial: Owned): {
  get(): Owned;
  set(next: Owned): void;
  subscribe(fn: (hasPlus: boolean) => void): () => void;
} {
  let owned = initial;
  const listeners = new Set<(hasPlus: boolean) => void>();
  return {
    get: () => owned,
    set(next) {
      if (next.plus === owned.plus && next.supporter === owned.supporter) return;
      owned = next;
      for (const fn of [...listeners]) fn(owned.plus);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Outcome the mock store gives the next purchase (`?store=pending`, tests). */
export type MockOutcome = Exclude<BuyResult, 'unavailable'>;

export interface MockStoreOptions {
  readonly plus?: boolean;
  readonly supporter?: boolean;
  /** `false`: behave like a build without a store. Default true. */
  readonly available?: boolean;
  /** What every purchase does until changed (default `purchased`). */
  readonly outcome?: MockOutcome;
  /** Simulated store round trip in ms (default 0). */
  readonly delayMs?: number;
}

/** A mutable in-memory store (web preview, tests, `?plus`). */
export interface MockEntitlements extends Entitlements {
  setPlus(value: boolean): void;
  setSupporter(value: boolean): void;
  /** Sets what the next purchases do. */
  setOutcome(outcome: MockOutcome): void;
  /** Completes the pending purchases (the delayed payment went through). */
  completePending(): void;
  /** Products bought through the mock (restore finds them again after a "reinstall"). */
  purchases(): readonly ProductId[];
}

export const MOCK_PRICES: Readonly<Record<ProductId, string>> = {
  [PRODUCT_PLUS]: '$2.99',
  [PRODUCT_SUPPORTER]: '$1.99',
};

export function mockEntitlements(options: MockStoreOptions | boolean = {}): MockEntitlements {
  const o: MockStoreOptions = typeof options === 'boolean' ? { plus: options } : options;
  const state = ownedState({ plus: o.plus ?? false, supporter: o.supporter ?? false });
  const available = o.available ?? true;
  const delay = o.delayMs ?? 0;
  let outcome: MockOutcome = o.outcome ?? 'purchased';
  const bought = new Set<ProductId>();
  const pending = new Set<ProductId>();
  const wait = (): Promise<void> =>
    delay > 0 ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve();
  const grant = (id: ProductId): void => {
    bought.add(id);
    const now = state.get();
    state.set(id === PRODUCT_PLUS ? { ...now, plus: true } : { ...now, supporter: true });
  };
  return {
    hasPlus: () => state.get().plus,
    hasSupporter: () => state.get().supporter,
    subscribe: state.subscribe,
    async products() {
      await wait();
      return available ? PRODUCT_IDS.map((id) => ({ id, price: MOCK_PRICES[id] })) : null;
    },
    async buy(id) {
      await wait();
      if (!available) return 'unavailable';
      if (outcome === 'purchased') grant(id);
      if (outcome === 'pending') pending.add(id);
      return outcome;
    },
    async restore() {
      await wait();
      if (!available) return 'unavailable';
      for (const id of bought) grant(id);
      const now = state.get();
      return now.plus || now.supporter ? 'restored' : 'nothing';
    },
    setPlus(value) {
      state.set({ ...state.get(), plus: value });
    },
    setSupporter(value) {
      state.set({ ...state.get(), supporter: value });
    },
    setOutcome(next) {
      outcome = next;
    },
    completePending() {
      for (const id of [...pending]) grant(id);
      pending.clear();
    },
    purchases: () => [...bought],
  };
}

/** A build without a store (native without a RevenueCat key): nothing is ever owned. */
export function unavailableEntitlements(): Entitlements {
  return mockEntitlements({ available: false });
}
