/**
 * App lifecycle behind the platform layer: the web implementation follows page visibility.
 * Native builds map Capacitor App `pause` / `resume` onto the same callback (T7.1).
 */

/** Calls `fn(visible)` whenever the app goes to the background or comes back. */
export function onAppVisibility(fn: (visible: boolean) => void): () => void {
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
