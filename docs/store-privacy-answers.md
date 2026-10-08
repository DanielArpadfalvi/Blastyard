# Store privacy answers (App Store "App Privacy", Google Play "Data safety")

The facts behind these answers are in `scripts/siteContent.ts` (`DATA_FACTS`) and the privacy
policy (`npm run site` → `/Blastyard/site/privacy.html`); `tests/unit/site.test.ts` keeps the
three in line. Basis: no analytics, crash-reporting or ad SDK in the app (CLAUDE.md); the
third-party services are RevenueCat for purchases (T8.1, `docs/PURCHASES.md`) and, for the optional
Online mode only, Supabase (`docs/ONLINE.md`).

## App Store Connect – App Privacy

**Do you or your third-party partners collect data from this app?** Yes – RevenueCat (purchases)
and, only for players who open the optional Online mode, Supabase (anonymous online account:
display name, friend code, friend list, invites; deletable in Settings → About).

| Data type | Collected | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|---|
| Purchases → **Purchase History** | Yes | **No** | **No** | App Functionality |
| Identifiers → **User ID** (random anonymous RevenueCat app user id; with Online also the anonymous online account id and display name) | Yes | **Yes** (online account – conservative) | **No** | App Functionality |
| User Content → **Other User Content** (online: display name, friend list, lobby invites) | Yes | **Yes** (conservative) | **No** | App Functionality |
| Everything else (contact info, health, financial info, location, contacts, user content, browsing / search history, usage data, diagnostics, device ID, other) | No | – | – | – |

- Tracking: **No** (no App Tracking Transparency prompt; no IDFA).
- Privacy policy URL: `https://danielarpadfalvi.github.io/Blastyard/site/privacy.html`
- iOS privacy manifest (`PrivacyInfo.xcprivacy`, T9.5): `NSPrivacyTracking` false, no tracking
  domains, collected types `NSPrivacyCollectedDataTypePurchaseHistory` (not linked),
  `NSPrivacyCollectedDataTypeUserID` and `NSPrivacyCollectedDataTypeOtherUserContent` (linked –
  the online account; not tracking; purpose App Functionality), and
  the required-reason APIs used (UserDefaults – `CA92.1`, via Capacitor / RevenueCat).

## Google Play – Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS / WSS).
- **Do you provide a way for users to request that their data is deleted?** Yes – in the app
  (Settings → About → Delete online profile) and by e-mail to the support address (the anonymous
  RevenueCat id can be deleted by RevenueCat on request); game data lives only on the device.

| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Financial info → **Purchase history** | Yes | No (processed by a service provider) | No (only when buying) | App functionality |
| Personal info → **User IDs** (online display name / account id) | Yes | No (service provider) | Yes (Online only) | App functionality |
| App activity → **Other user-generated content** (friend list, invites) | Yes | No (service provider) | Yes (Online only) | App functionality |
| App info and performance, device or other IDs, other personal info, location, messages, photos, audio, files, calendar, contacts, app activity, web browsing, health | No | No | – | – |

Notes for the form: the "User ID" of RevenueCat is a random id generated on the device, not an
account, so Play's "Device or other IDs" stays **No** only if RevenueCat's own Play disclosure
guidance agrees at submission time – check
<https://www.revenuecat.com/docs/platform-resources/apple-app-privacy> and the Play
equivalent before submitting (owner task in T9.5).

## Content rating / target audience
- Ads: **No**. In-app purchases: **Yes** (two optional non-consumables).
- Target age: all ages; not "designed for children" (avoids the Families-policy SDK
  requirements while being suitable for everyone). Age-rating questionnaire answers:
  `docs/store-listing.md`.
