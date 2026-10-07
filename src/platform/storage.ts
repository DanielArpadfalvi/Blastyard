/**
 * Key-value storage behind the platform layer. The web implementation uses `localStorage` and
 * silently degrades to memory when it is unavailable (private mode, quota, sandboxed iframes).
 * Native builds can swap in Capacitor Preferences behind the same interface (T7.1).
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** In-memory store (tests, and the fallback when `localStorage` is missing). */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
  };
}

/** `localStorage` with a memory fallback for every failing call. */
export function webStore(): KeyValueStore {
  const fallback = memoryStore();
  const ls = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return ls()?.getItem(key) ?? fallback.get(key);
      } catch {
        return fallback.get(key);
      }
    },
    set(key, value) {
      fallback.set(key, value);
      try {
        ls()?.setItem(key, value);
      } catch {
        // Quota or privacy mode: the memory copy keeps the session consistent.
      }
    },
    remove(key) {
      fallback.remove(key);
      try {
        ls()?.removeItem(key);
      } catch {
        // Ignore: nothing to clean up.
      }
    },
  };
}
