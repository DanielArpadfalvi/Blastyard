# Releasing Blastyard

## How a version is cut
1. Bump `version` in `package.json` (the only place: Android `versionName`, iOS
   `MARKETING_VERSION` via `ios/app-id.xcconfig`, Settings → About all read it). Build numbers
   are the GitHub run number (`VERSION_CODE`).
2. Update `whatsNew` in `scripts/storeListing.ts`, `npm run listing`, commit, merge to `main`.
3. Tag: `git tag v1.0.0 && git push origin v1.0.0` → `.github/workflows/release.yml`:
   checks the tag matches the version, runs `npm run check`, builds the **signed** Android
   App Bundle + APK and the **signed** iOS `.ipa`, and attaches them to a **draft** GitHub
   release.
4. Upload: `.aab` to Google Play (Internal testing → Production), `.ipa` to App Store Connect
   with Transporter (or Xcode Organizer) → TestFlight → review.
5. Store screenshots: Actions → *Store frames* → Run workflow → artifact `store-frames`
   (`npm run store:frames` locally, after `npm run build`).
6. Publish the draft release once both stores accepted the build.

Source maps are built hidden and moved to `sourcemaps/` (never inside `dist`, never in the
apps); keep the folder of a release build if you need to read a stack trace later.

## Checklist before tagging
- [ ] `npm run check` green; e2e green (`npm run test:e2e`; the CI perf spec is a known
      SwiftShader limitation, see HANDOFF)
- [ ] `npm run bot:league`, `npm run bot:league -- --arenas 100`, `npm run bot:league -- --match-length 60` OK
- [ ] `npm run sim:bench` OK
- [ ] QA device matrix in `docs/QA.md` filled for this version (no open P0 / P1)
- [ ] Store texts reviewed (`docs/store-listing.md`), privacy answers still true
      (`docs/store-privacy-answers.md`), site live (`/Blastyard/site/privacy.html`)
- [ ] RevenueCat: products and entitlements live in both stores; a sandbox purchase, a
      cancelled purchase, a pending purchase (Play test card "slow") and a restore checked
- [ ] Version bumped, `whatsNew` written

## Owner tasks (one-time)
| What | Where | Used by |
|---|---|---|
| Apple Developer Program + App Store Connect app (`com.arpadfalvi.blastyard`), Family Sharing on both IAPs | developer.apple.com | iOS release |
| App Store Connect API key (role App Manager / Admin): `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` (`base64 -i AuthKey_XXXX.p8`), `APPLE_TEAM_ID` | GitHub secrets | `release.yml` (cloud-managed signing) |
| Google Play Console app, Play App Signing on; upload keystore: `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000` → `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | GitHub secrets (keep the keystore safe offline too) | `release.yml` |
| RevenueCat project, products, entitlements; `VITE_REVENUECAT_ANDROID_KEY`, `VITE_REVENUECAT_IOS_KEY` | GitHub secrets, `docs/PURCHASES.md` | all native builds |
| GitHub Pages: Settings → Pages → Source "GitHub Actions"; repository variable `SUPPORT_EMAIL` | GitHub | privacy / support site |
| A support mailbox (the address in `SUPPORT_EMAIL`) | – | site, store listings |
| Google Drive APK upload: `GDRIVE_SERVICE_ACCOUNT_JSON` | GitHub secrets, `docs/RELEASE-drive.md` | `android.yml` |
| Age-rating questionnaires, privacy forms, screenshots, listing texts | both consoles | store review |

## Workflows
| File | When | Output |
|---|---|---|
| `ci.yml` | every push | checks, unit, e2e |
| `android.yml` | every push (not docs-only) | debug APK + unsigned AAB artifacts, debug APK → Drive, pre-release from `main` |
| `ios.yml` | `main`, and agent branches when iOS inputs change | simulator + unsigned device build |
| `release.yml` | tag `v*` / manual | signed `.aab`, `.apk`, `.ipa`; draft release |
| `store-frames.yml` | manual | store screenshots |
| `pages.yml` | `main` | web preview + privacy / support site |
