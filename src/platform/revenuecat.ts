/**
 * RevenueCat-backed {@link Entitlements} for the native shells (T8.1). The SDK is loaded lazily
 * (it is only needed on a device), configured with the platform's public API key (build-time
 * env `VITE_REVENUECAT_ANDROID_KEY` / `VITE_REVENUECAT_IOS_KEY`, owner secrets in CI) and an
 * anonymous app user id – no login, no tracking. Ownership comes from the SDK's customer info
 * (cached on the device by the SDK, so it works offline) and its update listener (pending
 * payments that complete later, Family Sharing, restores on another device).
 */

import { Capacitor } from '@capacitor/core';
import {
  ENTITLEMENT_PLUS,
  ENTITLEMENT_SUPPORTER,
  PRODUCT_IDS,
  ownedState,
  unavailableEntitlements,
  type BuyResult,
  type Entitlements,
  type Owned,
  type ProductId,
  type StoreProduct,
} from './entitlement';

import type * as RevenueCat from '@revenuecat/purchases-capacitor';

type Sdk = typeof RevenueCat;

interface CustomerInfoLike {
  readonly entitlements: { readonly active: Readonly<Record<string, unknown>> };
}

/** What a customer info grants. */
export function ownedFrom(info: CustomerInfoLike): Owned {
  const active = info.entitlements.active;
  return { plus: ENTITLEMENT_PLUS in active, supporter: ENTITLEMENT_SUPPORTER in active };
}

/** RevenueCat error codes (`PURCHASES_ERROR_CODE`) the paywall tells apart. */
const CANCELLED = '1';
const PENDING = '20';

/** Maps a purchase error to what the paywall shows. */
export function buyErrorResult(error: unknown): BuyResult {
  const e = (error ?? {}) as { code?: unknown; userCancelled?: unknown };
  if (e.userCancelled === true || String(e.code) === CANCELLED) return 'cancelled';
  if (String(e.code) === PENDING) return 'pending';
  return 'failed';
}

/** The public SDK key of this platform, or null. */
export function revenueCatKey(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const key =
    platform === 'ios'
      ? env.VITE_REVENUECAT_IOS_KEY
      : platform === 'android'
        ? env.VITE_REVENUECAT_ANDROID_KEY
        : undefined;
  return key && key.trim() !== '' ? key.trim() : null;
}

export function revenueCatEntitlements(
  apiKey: string,
  load: () => Promise<Sdk> = () => import('@revenuecat/purchases-capacitor'),
): Entitlements {
  const state = ownedState({ plus: false, supporter: false });
  let sdk: Sdk['Purchases'] | null = null;
  let category: Sdk['PRODUCT_CATEGORY'] | null = null;
  const products = new Map<ProductId, unknown>();

  const ready: Promise<Sdk['Purchases'] | null> = (async () => {
    try {
      const mod = await load();
      await mod.Purchases.configure({ apiKey });
      sdk = mod.Purchases;
      category = mod.PRODUCT_CATEGORY;
      await sdk.addCustomerInfoUpdateListener((info) => state.set(ownedFrom(info)));
      const { customerInfo } = await sdk.getCustomerInfo();
      state.set(ownedFrom(customerInfo));
      return sdk;
    } catch {
      return null;
    }
  })();

  const loadProducts = async (): Promise<readonly StoreProduct[] | null> => {
    const p = await ready;
    if (!p || !category) return null;
    try {
      const { products: list } = await p.getProducts({
        productIdentifiers: [...PRODUCT_IDS],
        type: category.NON_SUBSCRIPTION,
      });
      const out: StoreProduct[] = [];
      for (const id of PRODUCT_IDS) {
        const found = list.find((x) => x.identifier === id);
        if (!found) continue;
        products.set(id, found);
        out.push({ id, price: found.priceString });
      }
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };

  return {
    hasPlus: () => state.get().plus,
    hasSupporter: () => state.get().supporter,
    subscribe: state.subscribe,
    products: loadProducts,
    async buy(id) {
      const p = await ready;
      if (!p) return 'unavailable';
      if (!products.has(id)) await loadProducts();
      const product = products.get(id);
      if (!product) return 'unavailable';
      try {
        const { customerInfo } = await p.purchaseStoreProduct({
          product: product as Parameters<typeof p.purchaseStoreProduct>[0]['product'],
        });
        state.set(ownedFrom(customerInfo));
        const owned = state.get();
        return (id === PRODUCT_IDS[0] ? owned.plus : owned.supporter) ? 'purchased' : 'pending';
      } catch (error) {
        return buyErrorResult(error);
      }
    },
    async restore() {
      const p = await ready;
      if (!p) return 'unavailable';
      try {
        const { customerInfo } = await p.restorePurchases();
        const owned = ownedFrom(customerInfo);
        state.set(owned);
        return owned.plus || owned.supporter ? 'restored' : 'nothing';
      } catch {
        return 'unavailable';
      }
    },
  };
}

/** The native store port: RevenueCat with this platform's key, else "store unavailable". */
export function nativeEntitlements(): Entitlements {
  const key = revenueCatKey(
    Capacitor.getPlatform(),
    import.meta.env as unknown as Record<string, string | undefined>,
  );
  return key ? revenueCatEntitlements(key) : unavailableEntitlements();
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
