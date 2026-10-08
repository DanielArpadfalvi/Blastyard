/**
 * App lifecycle behind the platform layer: the web implementation follows page visibility;
 * the native shells use the Capacitor App plugin's `appStateChange` (T7.1), which also fires
 * when only the activity pauses (e.g. the notification shade on Android).
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** Calls `fn(visible)` whenever the app goes to the background or comes back. */
export function onAppVisibility(fn: (visible: boolean) => void): () => void {
  if (Capacitor.isNativePlatform()) {
    const handle = App.addListener('appStateChange', ({ isActive }) => fn(isActive));
    return () => {
      void handle.then((h) => h.remove());
    };
  }
  const doc = globalThis.document;
  if (!doc) return () => undefined;
  const handler = (): void => fn(doc.visibilityState !== 'hidden');
  doc.addEventListener('visibilitychange', handler);
  return () => doc.removeEventListener('visibilitychange', handler);
}

/** The user asked the OS for less motion (`prefers-reduced-motion`). */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
