/**
 * The versioned save (T6.2, PLAN §1.9): every persisted piece of the game – settings, party
 * setup, challenge stars, daily progress, tips, lifetime stats, looks – lives in ONE document
 * under {@link SAVE_KEY} in the platform key-value store:
 *
 *   { "version": 1, "entries": { "<part key>": "<that part's JSON>" , … } }
 *
 * {@link SaveStore} is itself a `KeyValueStore`, so each part keeps its own validated format and
 * reads / writes through the save exactly as it did through raw storage.
 *
 * Migrations: version 0 is the loose per-part keys of the 1.0 previews; the first load imports
 * them into the document and removes them. Later format changes add a step to
 * {@link MIGRATIONS} (version n → n + 1). A corrupt document never crashes the game: the parts
 * start from their defaults and the unreadable text is kept under {@link CORRUPT_KEY} for
 * support. A document from a *newer* app version is used as far as it goes and never written
 * back in an older format by a migration.
 */

import type { KeyValueStore } from '../platform/storage';

export const SAVE_KEY = 'blastyard.save';
export const SAVE_VERSION = 1;
/** Where an unreadable save is set aside (overwritten by the next corrupt one). */
export const CORRUPT_KEY = 'blastyard.save.corrupt';

/** The loose keys of the version-0 layout, imported by the first load. */
export const LEGACY_KEYS = [
  'blastyard.settings.v1',
  'blastyard.party.v1',
  'blastyard.challenges.v1',
  'blastyard.daily.v1',
  'blastyard.tips.v1',
] as const;

export interface SaveDoc {
  readonly version: number;
  readonly entries: Readonly<Record<string, string>>;
}

/** Version n → n + 1, keyed by n (≥ 1). Empty until the format changes. */
export type Migration = (doc: SaveDoc) => SaveDoc;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** Parses a stored document; null when it is not a save document at all. */
export function parseSave(raw: string): SaveDoc | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) return null;
  if (o.entries === null || typeof o.entries !== 'object' || Array.isArray(o.entries)) return null;
  const entries: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.entries as Record<string, unknown>)) {
    if (typeof v === 'string') entries[k] = v;
  }
  return { version: o.version, entries };
}

/** Runs every migration from `doc.version` up to `target`. */
export function migrate(
  doc: SaveDoc,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target = SAVE_VERSION,
): SaveDoc {
  let out = doc;
  while (out.version < target) {
    const step = migrations[out.version];
    out = step ? step(out) : { ...out, version: out.version + 1 };
  }
  return out;
}

export class SaveStore implements KeyValueStore {
  private doc: SaveDoc;
  /** False when the stored document is newer than this app: we read it but never rewrite it. */
  private readonly writable: boolean;

  constructor(
    private readonly backing: KeyValueStore,
    migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
    version = SAVE_VERSION,
  ) {
    const raw = backing.get(SAVE_KEY);
    let doc: SaveDoc | null = raw === null ? null : parseSave(raw);
    let dirty = false;
    if (raw !== null && doc === null) {
      // Unreadable: keep it aside, start fresh.
      backing.set(CORRUPT_KEY, raw);
      dirty = true;
    }
    if (doc === null) {
      doc = { version, entries: raw === null ? importLegacy(backing) : {} };
      dirty = true;
    }
    this.writable = doc.version <= version;
    if (this.writable && doc.version < version) {
      doc = migrate(doc, migrations, version);
      dirty = true;
    }
    this.doc = doc;
    if (dirty) this.flush();
    if (raw === null) for (const key of LEGACY_KEYS) backing.remove(key);
  }

  /** The save's format version as stored (newer than {@link SAVE_VERSION} = a newer app wrote it). */
  get storedVersion(): number {
    return this.doc.version;
  }

  get(key: string): string | null {
    return this.doc.entries[key] ?? null;
  }

  set(key: string, value: string): void {
    this.doc = { ...this.doc, entries: { ...this.doc.entries, [key]: value } };
    this.flush();
  }

  remove(key: string): void {
    if (!(key in this.doc.entries)) return;
    const entries = { ...this.doc.entries };
    delete entries[key];
    this.doc = { ...this.doc, entries };
    this.flush();
  }

  /** The whole document (support / tests). */
  snapshot(): SaveDoc {
    return this.doc;
  }

  private flush(): void {
    if (!this.writable) return;
    this.backing.set(SAVE_KEY, JSON.stringify(this.doc));
  }
}

/** Version 0 → 1: the loose per-part keys become entries of the document. */
function importLegacy(backing: KeyValueStore): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const key of LEGACY_KEYS) {
    const value = backing.get(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}
