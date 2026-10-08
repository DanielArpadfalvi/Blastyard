// Uploads a build to the owner's Google Drive folder, replacing the file of the same name
// (android.yml: the latest debug APK after every push).
//
//   node scripts/drive-upload.mjs <local file> <name in Drive>
//
// Env:
//   GDRIVE_FOLDER_ID              target folder
//   GDRIVE_SERVICE_ACCOUNT_JSON   service-account key (JSON). The folder must be shared with the
//                                 account's e-mail as Editor. A service account has no storage of
//                                 its own, so it updates a file that already exists in the folder
//                                 (owned by the owner); it cannot create one in a personal Drive.
//   or GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET + GDRIVE_REFRESH_TOKEN   OAuth user credentials
//                                 (can also create the file).
// No dependencies: Node 22 fetch + crypto.

import { createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const MIME = 'application/vnd.android.package-archive';

const b64url = (data) => Buffer.from(data).toString('base64url');

async function tokenFromServiceAccount(json) {
  const key = JSON.parse(json);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;
  return token({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt });
}

function tokenFromRefresh(env) {
  return token({
    grant_type: 'refresh_token',
    client_id: env.GDRIVE_CLIENT_ID,
    client_secret: env.GDRIVE_CLIENT_SECRET,
    refresh_token: env.GDRIVE_REFRESH_TOKEN,
  });
}

async function token(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function call(url, auth, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${auth}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [path, name] = argv;
  const folder = env.GDRIVE_FOLDER_ID;
  if (!path || !name || !folder) {
    console.error('usage: GDRIVE_FOLDER_ID=… node scripts/drive-upload.mjs <file> <name>');
    return 2;
  }
  const auth = env.GDRIVE_SERVICE_ACCOUNT_JSON
    ? await tokenFromServiceAccount(env.GDRIVE_SERVICE_ACCOUNT_JSON)
    : await tokenFromRefresh(env);
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${folder}' in parents and trashed = false`,
  );
  const found = await call(
    `${API}/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    auth,
  );
  const data = readFileSync(path);
  const size = statSync(path).size;
  const [existing, ...extra] = found.files ?? [];
  let id;
  if (existing) {
    // Same file id every time: the owner's link keeps pointing at the newest build.
    await call(`${UPLOAD}/files/${existing.id}?uploadType=media&supportsAllDrives=true`, auth, {
      method: 'PATCH',
      headers: { 'content-type': MIME },
      body: data,
    });
    id = existing.id;
    // Older duplicates (e.g. created by hand) would hide which one is current.
    for (const f of extra) {
      await call(`${API}/files/${f.id}?supportsAllDrives=true`, auth, { method: 'DELETE' }).catch(
        (e) => console.warn(`could not remove duplicate ${f.id}: ${e.message}`),
      );
    }
  } else {
    const boundary = `blastyard${Date.now()}`;
    const meta = JSON.stringify({ name, parents: [folder], mimeType: MIME });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${boundary}\r\ncontent-type: ${MIME}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const created = await call(
      `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
      auth,
      {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    id = created.id;
  }
  console.log(`drive: ${name} (${(size / 1048576).toFixed(1)} MB) → file ${id}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    },
  );
}
