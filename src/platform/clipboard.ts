/**
 * Clipboard behind the platform layer. The web implementation uses the async Clipboard API (needs
 * a secure context: https or localhost) and falls back to a hidden textarea + `copy` command for
 * plain-http LAN previews. A native Capacitor implementation can replace it later without touching
 * callers.
 */

export interface ClipboardPort {
  /** Resolves to true when the text reached the clipboard. */
  writeText(text: string): Promise<boolean>;
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    // Deprecated but still the only option outside secure contexts.
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export const webClipboard: ClipboardPort = {
  async writeText(text) {
    const api = globalThis.navigator?.clipboard;
    if (api && globalThis.isSecureContext) {
      try {
        await api.writeText(text);
        return true;
      } catch {
        // Permission denied or no user activation: try the legacy path.
      }
    }
    return legacyCopy(text);
  },
};
