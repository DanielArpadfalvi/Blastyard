/**
 * Haptics behind the platform layer (PLAN §1.3: default off in table mode, decided by the game
 * layer). The web implementation uses the Vibration API, and only after the page has seen a user
 * gesture (browsers block and log `vibrate` calls before that). Native builds swap in Capacitor
 * Haptics behind the same interface (T7.1).
 */

export type HapticKind = 'light' | 'medium' | 'heavy';

export interface HapticsPort {
  pulse(kind: HapticKind): void;
}

/** Vibration length per kind (ms) for the web fallback. */
export const WEB_VIBRATION_MS: Readonly<Record<HapticKind, number>> = {
  light: 8,
  medium: 18,
  heavy: 40,
};

export const webHaptics: HapticsPort = {
  pulse(kind) {
    const nav = globalThis.navigator as
      (Navigator & { userActivation?: { hasBeenActive: boolean } }) | undefined;
    if (!nav || typeof nav.vibrate !== 'function') return;
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
    try {
      nav.vibrate(WEB_VIBRATION_MS[kind]);
    } catch {
      // Not allowed here (iframe policy): haptics are optional.
    }
  },
};

/** Recording implementation for tests and the `?test` hook. */
export interface RecordingHaptics extends HapticsPort {
  readonly pulses: HapticKind[];
}

export function recordingHaptics(): RecordingHaptics {
  const pulses: HapticKind[] = [];
  return {
    pulses,
    pulse(kind) {
      pulses.push(kind);
    },
  };
}
