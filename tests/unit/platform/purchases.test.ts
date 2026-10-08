import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_PLUS,
  PRODUCT_SUPPORTER,
  mockEntitlements,
  unavailableEntitlements,
} from '../../../src/platform/entitlement';
import {
  buyErrorResult,
  ownedFrom,
  revenueCatEntitlements,
  revenueCatKey,
} from '../../../src/platform/revenuecat';
import { parseStoreChoice, webEntitlements } from '../../../src/platform/store';

const info = (...active: string[]) => ({
  entitlements: { active: Object.fromEntries(active.map((a) => [a, {}])) },
});

describe('mock store (web preview, tests)', () => {
  it('lists both products with prices and unlocks on purchase', async () => {
    const store = mockEntitlements();
    const seen: boolean[] = [];
    store.subscribe((plus) => seen.push(plus));
    expect((await store.products())?.map((p) => p.id)).toEqual([PRODUCT_PLUS, PRODUCT_SUPPORTER]);
    expect(store.hasPlus()).toBe(false);
    expect(await store.buy(PRODUCT_PLUS)).toBe('purchased');
    expect(store.hasPlus()).toBe(true);
    expect(store.hasSupporter()).toBe(false);
    expect(seen).toEqual([true]);
    expect(await store.buy(PRODUCT_SUPPORTER)).toBe('purchased');
    expect(store.hasSupporter()).toBe(true);
  });

  it('cancelled and failed purchases unlock nothing', async () => {
    for (const outcome of ['cancelled', 'failed'] as const) {
      const store = mockEntitlements({ outcome });
      expect(await store.buy(PRODUCT_PLUS)).toBe(outcome);
      expect(store.hasPlus()).toBe(false);
      expect(await store.restore()).toBe('nothing');
    }
  });

  it('a pending payment unlocks only when the store confirms it', async () => {
    const store = mockEntitlements({ outcome: 'pending' });
    const fn = vi.fn();
    store.subscribe(fn);
    expect(await store.buy(PRODUCT_PLUS)).toBe('pending');
    expect(store.hasPlus()).toBe(false);
    store.completePending();
    expect(store.hasPlus()).toBe(true);
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('restore finds earlier purchases again', async () => {
    const store = mockEntitlements();
    await store.buy(PRODUCT_SUPPORTER);
    store.setSupporter(false); // "reinstalled"
    expect(await store.restore()).toBe('restored');
    expect(store.hasSupporter()).toBe(true);
  });

  it('without a store nothing can be bought or restored – and nothing unlocks', async () => {
    for (const store of [unavailableEntitlements(), mockEntitlements({ available: false })]) {
      expect(await store.products()).toBeNull();
      expect(await store.buy(PRODUCT_PLUS)).toBe('unavailable');
      expect(await store.restore()).toBe('unavailable');
      expect(store.hasPlus()).toBe(false);
      expect(store.hasSupporter()).toBe(false);
    }
  });

  it('?store= picks the mock behaviour; the web has no store unless asked', async () => {
    expect(parseStoreChoice('pending')).toBe('pending');
    expect(parseStoreChoice('free-stuff')).toBeNull();
    const none = webEntitlements({ test: false, plus: false, supporter: false, store: null });
    expect(await none.products()).toBeNull();
    const test = webEntitlements({ test: true, plus: false, supporter: false, store: null });
    expect(await test.products()).not.toBeNull();
    const pending = webEntitlements({
      test: true,
      plus: false,
      supporter: false,
      store: 'pending',
    });
    expect(await pending.buy(PRODUCT_PLUS)).toBe('pending');
    const owned = webEntitlements({ test: false, plus: true, supporter: true, store: null });
    expect(owned.hasPlus() && owned.hasSupporter()).toBe(true);
  });
});

/** A fake RevenueCat SDK module. */
function fakeSdk(
  opts: { purchase?: () => Promise<unknown>; configure?: () => Promise<void> } = {},
) {
  let listener: ((i: ReturnType<typeof info>) => void) | null = null;
  let customer = info();
  const Purchases = {
    configure: vi.fn(opts.configure ?? (() => Promise.resolve())),
    addCustomerInfoUpdateListener: vi.fn((fn: (i: ReturnType<typeof info>) => void) => {
      listener = fn;
      return Promise.resolve('cb');
    }),
    getCustomerInfo: vi.fn(() => Promise.resolve({ customerInfo: customer })),
    getProducts: vi.fn(() =>
      Promise.resolve({
        products: [
          { identifier: PRODUCT_PLUS, priceString: '2,99 €' },
          { identifier: PRODUCT_SUPPORTER, priceString: '1,99 €' },
        ],
      }),
    ),
    purchaseStoreProduct: vi.fn(
      opts.purchase ??
        (() => {
          customer = info('plus');
          return Promise.resolve({ customerInfo: customer });
        }),
    ),
    restorePurchases: vi.fn(() => Promise.resolve({ customerInfo: info('plus', 'supporter') })),
  };
  const mod = { Purchases, PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' } };
  return {
    mod,
    Purchases,
    push: (i: ReturnType<typeof info>) => listener?.(i),
    load: () => Promise.resolve(mod as never),
  };
}

describe('RevenueCat port', () => {
  it('maps customer info, errors and keys', () => {
    expect(ownedFrom(info('plus'))).toEqual({ plus: true, supporter: false });
    expect(ownedFrom(info('supporter'))).toEqual({ plus: false, supporter: true });
    expect(buyErrorResult({ code: '1' })).toBe('cancelled');
    expect(buyErrorResult({ userCancelled: true, code: '2' })).toBe('cancelled');
    expect(buyErrorResult({ code: '20' })).toBe('pending');
    expect(buyErrorResult(new Error('boom'))).toBe('failed');
    expect(buyErrorResult(undefined)).toBe('failed');
    const env = { VITE_REVENUECAT_IOS_KEY: 'appl_x', VITE_REVENUECAT_ANDROID_KEY: ' ' };
    expect(revenueCatKey('ios', env)).toBe('appl_x');
    expect(revenueCatKey('android', env)).toBeNull();
    expect(revenueCatKey('web', env)).toBeNull();
  });

  it('configures with the key, reads prices and buys Blastyard+', async () => {
    const sdk = fakeSdk();
    const store = revenueCatEntitlements('goog_key', sdk.load);
    expect(await store.products()).toEqual([
      { id: PRODUCT_PLUS, price: '2,99 €' },
      { id: PRODUCT_SUPPORTER, price: '1,99 €' },
    ]);
    expect(sdk.Purchases.configure).toHaveBeenCalledWith({ apiKey: 'goog_key' });
    expect(sdk.Purchases.getProducts).toHaveBeenCalledWith({
      productIdentifiers: [PRODUCT_PLUS, PRODUCT_SUPPORTER],
      type: 'NON_SUBSCRIPTION',
    });
    expect(store.hasPlus()).toBe(false);
    expect(await store.buy(PRODUCT_PLUS)).toBe('purchased');
    expect(store.hasPlus()).toBe(true);
  });

  it('cancel and pending from the store; a later update unlocks the pending purchase', async () => {
    const cancelled = fakeSdk({
      purchase: () => Promise.reject({ code: '1', userCancelled: true }),
    });
    const a = revenueCatEntitlements('k', cancelled.load);
    expect(await a.buy(PRODUCT_PLUS)).toBe('cancelled');
    expect(a.hasPlus()).toBe(false);

    const pending = fakeSdk({ purchase: () => Promise.reject({ code: '20' }) });
    const b = revenueCatEntitlements('k', pending.load);
    const fn = vi.fn();
    b.subscribe(fn);
    expect(await b.buy(PRODUCT_PLUS)).toBe('pending');
    expect(b.hasPlus()).toBe(false);
    pending.push(info('plus'));
    expect(b.hasPlus()).toBe(true);
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('restores both entitlements', async () => {
    const sdk = fakeSdk();
    const store = revenueCatEntitlements('k', sdk.load);
    expect(await store.restore()).toBe('restored');
    expect(store.hasPlus() && store.hasSupporter()).toBe(true);
  });

  it('a store that cannot start is "unavailable" and never unlocks', async () => {
    const sdk = fakeSdk({ configure: () => Promise.reject(new Error('no billing')) });
    const store = revenueCatEntitlements('k', sdk.load);
    expect(await store.products()).toBeNull();
    expect(await store.buy(PRODUCT_PLUS)).toBe('unavailable');
    expect(await store.restore()).toBe('unavailable');
    expect(store.hasPlus()).toBe(false);
  });
});
