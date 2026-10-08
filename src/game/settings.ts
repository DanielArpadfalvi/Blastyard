/**
 * Player settings (T3.2/T3.3, T6.1): music and effect volume, haptics, game speed, reduced motion,
 * language, controls (scheme, left-handed swap, zone size), corner-assist strength, the friendly
 * rule and larger text. Persisted as JSON through the platform key-value store; anything
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

/** `auto` follows the device language. */
export const LANGUAGE_OPTIONS = ['auto', 'en', 'hu'] as const;
export type LanguageSetting = (typeof LANGUAGE_OPTIONS)[number];

/** Two thumbs (floating stick + bomb button) or one finger (stick, tap = pop) when alone. */
export const SCHEME_OPTIONS = ['twoThumb', 'oneFinger'] as const;
export type SchemeSetting = (typeof SCHEME_OPTIONS)[number];

/** Zone size slider (PLAN §1.4: 80–120 %): scales the bomb button and the stick follow radius. */
export const ZONE_SCALES = [80, 90, 100, 110, 120] as const;
export type ZoneScale = (typeof ZONE_SCALES)[number];

/** Corner-assist strength (PLAN §1.12). */
export const ASSIST_OPTIONS = ['low', 'normal', 'high'] as const;
export type AssistSetting = (typeof ASSIST_OPTIONS)[number];

export interface Settings {
  /** 0–1. */
  readonly musicVolume: number;
  /** 0–1. */
  readonly sfxVolume: number;
  readonly haptics: HapticsSetting;
  readonly gameSpeed: GameSpeed;
  /** No screen shake or flash, fewer particles. */
  readonly reducedMotion: boolean;
  readonly language: LanguageSetting;
  readonly scheme: SchemeSetting;
  /** Stick on the right, bomb button on the left. */
  readonly leftHanded: boolean;
  readonly zoneScale: ZoneScale;
  readonly cornerAssist: AssistSetting;
  /** Friendly rule: your own pops never knock you out (party / quick / solo, not challenges). */
  readonly friendly: boolean;
  readonly largeText: boolean;
}

export function defaultSettings(systemReducedMotion = false): Settings {
  return {
    musicVolume: 0.6,
    sfxVolume: 0.8,
    haptics: 'auto',
    gameSpeed: 100,
    reducedMotion: systemReducedMotion,
    language: 'auto',
    scheme: 'twoThumb',
    leftHanded: false,
    zoneScale: 100,
    cornerAssist: 'normal',
    friendly: false,
    largeText: false,
  };
}

function oneOf<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
    reducedMotion: bool(o.reducedMotion, defaults.reducedMotion),
    language: oneOf(LANGUAGE_OPTIONS, o.language, defaults.language),
    scheme: oneOf(SCHEME_OPTIONS, o.scheme, defaults.scheme),
    leftHanded: bool(o.leftHanded, defaults.leftHanded),
    zoneScale: oneOf(ZONE_SCALES, o.zoneScale, defaults.zoneScale),
    cornerAssist: oneOf(ASSIST_OPTIONS, o.cornerAssist, defaults.cornerAssist),
    friendly: bool(o.friendly, defaults.friendly),
    largeText: bool(o.largeText, defaults.largeText),
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
