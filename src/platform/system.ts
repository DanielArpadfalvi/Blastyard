/**
 * Device behaviour around a match (T7.1, PLAN §1.3) behind the platform layer:
 *
 * - keep the screen awake during the lobby and matches (not in menus);
 * - lock the orientation to the current landscape side during the lobby and matches (menus allow
 *   both landscape sides – the native shells never allow portrait);
 * - keep the system edge gestures (Android back / home swipes) away from the control zones.
 *
 * Native: the app's own `BlastyardSystem` plugin (Android `BlastyardSystemPlugin.java`, iOS
 * `BlastyardSystemPlugin.swift`) and `@capacitor/screen-orientation`. Web: the Screen Wake Lock
 * API and `screen.orientation.lock` where the browser allows them, nothing otherwise. Every port
 * skips calls that would not change anything.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { ScreenOrientation as NativeOrientation } from '@capacitor/screen-orientation';

/** A rectangle in CSS pixels of the viewport. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SystemPort {
  keepAwake(on: boolean): void;
  /** true: stay on the current landscape side; false: either landscape side. */
  lockOrientation(locked: boolean): void;
  /** Areas the system edge swipes must leave alone (empty = none). */
  excludeGestures(rects: readonly ScreenRect[]): void;
}

/** What a port was last told (tests, debugging). */
export interface SystemState {
  readonly awake: boolean;
  readonly locked: boolean;
  readonly rects: readonly ScreenRect[];
}

interface BlastyardSystemPlugin {
  setKeepAwake(options: { on: boolean }): Promise<void>;
  setGestureExclusion(options: { rects: ScreenRect[] }): Promise<void>;
}

const BlastyardSystem = registerPlugin<BlastyardSystemPlugin>('BlastyardSystem');

const quiet = (p: Promise<unknown> | undefined): void => {
  void p?.catch(() => undefined);
};

const rectsKey = (rects: readonly ScreenRect[]): string =>
  rects
    .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`)
    .join(';');

/** Wraps `raw` so repeated calls with the same value do nothing; exposes the last state. */
export function dedupedSystem(raw: SystemPort): SystemPort & { state(): SystemState } {
  let awake: boolean | null = null;
  let locked: boolean | null = null;
  let key: string | null = null;
  let rects: readonly ScreenRect[] = [];
  return {
    keepAwake(on) {
      if (on === awake) return;
      awake = on;
      raw.keepAwake(on);
    },
    lockOrientation(next) {
      if (next === locked) return;
      locked = next;
      raw.lockOrientation(next);
    },
    excludeGestures(next) {
      const k = rectsKey(next);
      if (k === key) return;
      key = k;
      rects = next.map((r) => ({ ...r }));
      raw.excludeGestures(rects);
    },
    state: () => ({ awake: awake ?? false, locked: locked ?? false, rects }),
  };
}

/** Android / iOS shells. */
export function nativeSystem(): SystemPort {
  return {
    keepAwake: (on) => quiet(BlastyardSystem.setKeepAwake({ on })),
    lockOrientation(locked) {
      if (!locked) {
        quiet(NativeOrientation.lock({ orientation: 'landscape' }));
        return;
      }
      quiet(
        NativeOrientation.orientation().then(({ type }) =>
          NativeOrientation.lock({
            orientation:
              type === 'landscape-secondary' ? 'landscape-secondary' : 'landscape-primary',
          }),
        ),
      );
    },
    excludeGestures: (rects) => quiet(BlastyardSystem.setGestureExclusion({ rects: [...rects] })),
  };
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/** Browsers: Screen Wake Lock and orientation lock where allowed (usually only in full screen). */
export function webSystem(): SystemPort {
  let sentinel: WakeLockSentinelLike | null = null;
  const nav = globalThis.navigator as
    | (Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } })
    | undefined;
  const orientation = globalThis.screen?.orientation as
    (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
  return {
    keepAwake(on) {
      if (on) {
        nav?.wakeLock?.request('screen').then(
          (s) => {
            sentinel = s;
          },
          () => undefined,
        );
      } else {
        quiet(sentinel?.release());
        sentinel = null;
      }
    },
    lockOrientation(locked) {
      try {
        if (locked) quiet(orientation?.lock?.(orientation.type ?? 'landscape'));
        else orientation?.unlock?.();
      } catch {
        // Not allowed outside full screen: the device keeps rotating, nothing to do.
      }
    },
    excludeGestures: () => undefined,
  };
}

export function platformSystem(): SystemPort & { state(): SystemState } {
  return dedupedSystem(Capacitor.isNativePlatform() ? nativeSystem() : webSystem());
}
