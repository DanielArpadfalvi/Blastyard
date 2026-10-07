/**
 * Player settings that shape the game feel (T3.2/T3.3): music and effect volume, haptics, game
 * speed and reduced motion. Persisted as JSON through the platform key-value store; anything
 * missing or invalid falls back to the default, so a corrupt entry never breaks the game. The
 * full settings screen and the versioned save come with T6.1/T6.2.
 *
 * Pure apart from the injected store.
 */

import type { KeyValueStore } from '../platform/storage';
import type { GameMode } from './modes';

export const SETTINGS_KEY = 'blastyard.settings.v1';

/** Game speed options in percent (PLAN §1.12): only the real-time tick clock slows down. */
export const GAME_SPEEDS = [70, 85, 100] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

/** `auto`: on when one player holds the device, off at the table (PLAN §1.3). */
export const HAPTICS_OPTIONS = ['auto', 'on', 'off'] as const;
export type HapticsSetting = (typeof HAPTICS_OPTIONS)[number];

export interface Settings {
  /** 0–1. */
  readonly musicVolume: number;
  /** 0–1. */
  readonly sfxVolume: number;
  readonly haptics: HapticsSetting;
  readonly gameSpeed: GameSpeed;
  /** No screen shake or flash, fewer particles. */
  readonly reducedMotion: boolean;
}

export function defaultSettings(systemReducedMotion = false): Settings {
  return {
    musicVolume: 0.6,
    sfxVolume: 0.8,
    haptics: 'auto',
    gameSpeed: 100,
    reducedMotion: systemReducedMotion,
  };
}

function volume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/** Validates an untrusted settings object field by field. */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    musicVolume: volume(o.musicVolume, defaults.musicVolume),
    sfxVolume: volume(o.sfxVolume, defaults.sfxVolume),
    haptics: HAPTICS_OPTIONS.includes(o.haptics as HapticsSetting)
      ? (o.haptics as HapticsSetting)
      : defaults.haptics,
    gameSpeed: GAME_SPEEDS.includes(o.gameSpeed as GameSpeed)
      ? (o.gameSpeed as GameSpeed)
      : defaults.gameSpeed,
    reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : defaults.reducedMotion,
  };
}

/** Real-time clock factor of a game speed (1 = 100 %). */
export function speedFactor(speed: GameSpeed): number {
  return speed / 100;
}

/**
 * Whether haptics fire in `mode` (bot-only attract matches never vibrate). `auto` means on when a
 * single player holds the device: solo, challenges and a party with one human (`humans`).
 */
export function hapticsEnabled(setting: HapticsSetting, mode: GameMode, humans?: number): boolean {
  if (mode === 'attract' || setting === 'off') return false;
  if (setting === 'on') return true;
  if (mode === 'party') return humans === 1;
  return mode === 'solo' || mode === 'challenge';
}

/** Loads, validates and persists settings; notifies subscribers on every change. */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(
    private readonly store: KeyValueStore,
    private readonly defaults: Settings = defaultSettings(),
  ) {
    this.value = this.load();
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): Settings {
    this.value = sanitizeSettings({ ...this.value, ...patch }, this.defaults);
    this.store.set(SETTINGS_KEY, JSON.stringify(this.value));
    for (const fn of this.listeners) fn(this.value);
    return this.value;
  }

  /** Applies `patch` for this session only (query options in tests); nothing is saved. */
  override(patch: Partial<Settings>): void {
    this.value = sanitizeSettings({ ...this.value, ...patch }, this.defaults);
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private load(): Settings {
    const raw = this.store.get(SETTINGS_KEY);
    if (raw === null) return this.defaults;
    try {
      return sanitizeSettings(JSON.parse(raw), this.defaults);
    } catch {
      return this.defaults;
    }
  }
}
