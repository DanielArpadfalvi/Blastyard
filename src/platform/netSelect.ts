/**
 * Which online backend this build talks to: `?net=local` → the tabs of this browser (dev, e2e);
 * a build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` → Supabase; otherwise none (the
 * Online screen explains that online play is not available).
 */

import { localTabsNet, unavailableNet, type NetPort } from './net';
import { supabaseNet } from './supabaseNet';

export function platformNet(mode: 'local' | null): NetPort {
  if (mode === 'local' && typeof BroadcastChannel !== 'undefined') return localTabsNet();
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? supabaseNet(url, key) : unavailableNet();
}
