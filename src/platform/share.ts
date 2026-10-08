/**
 * Sharing a lobby code: the system share sheet where the browser / WebView offers one
 * (`navigator.share`), otherwise the clipboard. Resolves to how it went.
 */

import { webClipboard, type ClipboardPort } from './clipboard';

export type ShareResult = 'shared' | 'copied' | 'failed';

export async function shareText(
  text: string,
  clipboard: ClipboardPort = webClipboard,
): Promise<ShareResult> {
  const nav = globalThis.navigator as
    (Navigator & { share?: (d: ShareData) => Promise<void> }) | undefined;
  if (nav?.share) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (e) {
      // The player closed the sheet: nothing else to do.
      if ((e as { name?: string })?.name === 'AbortError') return 'failed';
    }
  }
  return (await clipboard.writeText(text)) ? 'copied' : 'failed';
}
