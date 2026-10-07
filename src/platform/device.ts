/**
 * Device facts for diagnostics (touch tester report). Web implementation; native builds may later
 * add the model name from Capacitor's Device plugin behind the same interface.
 */

export interface DeviceInfo {
  readonly userAgent: string;
  /** Viewport in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export function readDeviceInfo(): DeviceInfo {
  const w = globalThis.window;
  return {
    userAgent: globalThis.navigator?.userAgent ?? 'unknown',
    width: w?.innerWidth ?? 0,
    height: w?.innerHeight ?? 0,
    devicePixelRatio: w?.devicePixelRatio ?? 1,
  };
}
