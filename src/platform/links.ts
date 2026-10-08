/**
 * Outside links (T6.1 settings "About"; the pages themselves come with T9.3) and opening them.
 * Capacitor opens a navigation to another origin in the system browser, so a plain
 * `window.open` works on the web and in the native shells alike.
 */

const SITE = 'https://danielarpadfalvi.github.io/Blastyard/site';

export const PRIVACY_URL = `${SITE}/privacy.html`;
export const SUPPORT_URL = `${SITE}/support.html`;

export function openExternal(url: string): void {
  try {
    globalThis.open?.(url, '_blank', 'noopener');
  } catch {
    // Popup blocked or no window: nothing else to do.
  }
}
