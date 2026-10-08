# Newest debug APK → Google Drive

After every push (any branch; docs-only pushes excepted) `.github/workflows/android.yml` builds
the debug APK and overwrites **`Blastyard-debug.apk`** in the owner's Drive folder
**Mobile games** (`https://drive.google.com/drive/folders/1zTqiGB7KHX0puHztEt7Ol2hCYDxPv1uk`).
The file keeps its id, so a shared or bookmarked link always opens the newest build:
`https://drive.google.com/file/d/1KIfIFU7vB4m6ArCUlfdyGSGxWhSsUHvm/view`.
The upload is done by `scripts/drive-upload.mjs` (no dependencies).

GitHub Actions cannot use the Google Drive connector of a Claude session. It needs its own
credentials, stored as a repository secret. Until a secret is set, the step only prints a
warning and the build stays green.

## One-time setup (owner, ~10 minutes) – service account (recommended)
A service account's key does not expire. (An OAuth app in "Testing" status loses its refresh
token after 7 days.)

1. <https://console.cloud.google.com/> → create a project (e.g. `blastyard-ci`).
2. *APIs & Services → Library* → enable **Google Drive API**.
3. *IAM & Admin → Service accounts* → *Create service account* (e.g. `blastyard-ci`); no roles
   needed. Open it → *Keys → Add key → Create new key → JSON* → a `.json` file downloads.
4. In Google Drive, share the **Mobile games** folder with the service account's e-mail
   (`…@….iam.gserviceaccount.com`) as **Editor**.
5. GitHub → repository → *Settings → Secrets and variables → Actions → New repository secret*:
   name `GDRIVE_SERVICE_ACCOUNT_JSON`, value = the whole content of the JSON file. Then delete
   the downloaded file.

A service account has no Drive storage of its own, so it can only **update** a file that already
exists in the folder (the owner's storage counts). That file, `Blastyard-debug.apk`, was created
as a placeholder on 2026-10-08. If it is ever deleted, upload any file with exactly that name
into the folder again.

## Alternative – OAuth user credentials
Secrets `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN` (scope
`https://www.googleapis.com/auth/drive`). This can also create the file, but the OAuth consent
screen must be *In production*, otherwise the token stops working after 7 days.

## Other folder
Repository variable `GDRIVE_FOLDER_ID` overrides the folder.
