# Purchases (T8.1)

Two non-consumables. Everything else is free, without exceptions: every mode, 1–4 players, all
bot levels and power-ups (`tests/unit/game/monetization.test.ts` enforces this).

| Product id | RevenueCat entitlement | Price (plan) | What it unlocks |
|---|---|---|---|
| `blastyard_plus` | `plus` | ≈ 2.99 USD | 6 arenas, challenge worlds 2–3 (24 levels), custom rules, 4 Puffs, 6 hats, 3 pop skins, rainbow trail |
| `blastyard_supporter` | `supporter` | ≈ 1.99 USD | supporter crown (hat), confetti trail, thank-you screen |

## Code
- `src/platform/entitlement.ts`: the `Entitlements` port (`hasPlus`, `hasSupporter`, `products`,
  `buy` → `purchased | pending | cancelled | failed | unavailable`, `restore`), the mock store.
- `src/platform/revenuecat.ts`: RevenueCat (`@revenuecat/purchases-capacitor`), loaded lazily on
  the device, anonymous app user id, ownership from the SDK's customer info and update listener
  (pending payments, Family Sharing, other devices).
- `src/platform/store.ts`: which port a build uses. Native: RevenueCat with
  `VITE_REVENUECAT_ANDROID_KEY` / `VITE_REVENUECAT_IOS_KEY` (build-time). Without a key: "store
  unavailable", nothing ever unlocks. Web: no store, except the mock with `?test` or
  `?store=mock|pending|cancelled|failed|none`. `?plus` / `?supporter` pretend ownership.
- UI: `src/ui/Paywall.tsx` (paywall, Supporter thanks, the one-off card), `src/ui/CustomRules.tsx`.
  The paywall opens only from a locked item (arena, challenge world, custom rules, Plus /
  Supporter cosmetic), from Settings → About → "Blastyard+ & Supporter", or from the single card
  shown under the result after the 5th finished match (stored as notice `plusHint`).

## Owner setup (before the store release)
1. **App Store Connect / Play Console**: create both in-app products as *non-consumable*
   (Play: "one-time product") with the ids above; turn on **Family Sharing** for both on iOS.
2. **RevenueCat**: create the project and the two apps (iOS bundle / Android package
   `com.arpadfalvi.blastyard`), import the products, create entitlements `plus` and `supporter`
   and attach each product to its entitlement. (Offerings are not used: the app asks for the two
   products directly.)
3. **GitHub secrets**: `VITE_REVENUECAT_ANDROID_KEY` (`goog_…`) and `VITE_REVENUECAT_IOS_KEY`
   (`appl_…`) – the *public* SDK keys. `android.yml` / `ios.yml` pass them to the web build.
4. Test with a Play license tester / StoreKit sandbox account: buy, cancel, a slow test card
   (pending), restore after reinstall.

## Privacy
RevenueCat stores the purchase history under an anonymous app user id; no login, no analytics,
no tracking (store privacy label: Purchase History + User ID, not linked to the user, not used
for tracking). Details for the listing: T9.1 `docs/store-privacy-answers.md`.
