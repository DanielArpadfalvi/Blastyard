/**
 * Custom rules (Blastyard+, PLAN §1.6 "Saját szabályok"): round length, start stats, power-ups on /
 * off with a frequency each, power-up chance, sudden death and ghost revenge. The free presets stay
 * free; a custom setup without Blastyard+ plays the Classic preset (never Plus content). Every
 * field maps onto the core `Rules` – no simulation change. Pure: no DOM.
 */

import type { ArenaDef } from '../core';
import { CLASSIC_RULES, DEFAULT_POWERUP_WEIGHTS, PICKUP_KIND_COUNT, type Rules } from '../core';

/** Per power-up frequency: off, rare (½), normal (1×), often (2×). */
export type PowerLevel = 0 | 1 | 2 | 3;
export const POWER_LEVELS: readonly PowerLevel[] = [0, 1, 2, 3];

export interface CustomRules {
  /** Seconds before sudden death; 0 = no time limit. */
  readonly roundSeconds: number;
  readonly startBombs: number;
  readonly startRange: number;
  readonly startSpeed: number;
  /** Percent of crates that hide a power-up. */
  readonly powerupChance: number;
  /** Frequency per `Pickup` kind − 1 (9 entries). */
  readonly powerups: readonly PowerLevel[];
  readonly suddenDeath: 'spiral' | 'none';
  readonly ghosts: boolean;
}

export const ROUND_OPTIONS: readonly number[] = [60, 90, 120, 180, 0];
export const START_BOMB_OPTIONS: readonly number[] = [1, 2, 3, 4];
export const START_RANGE_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];
export const START_SPEED_OPTIONS: readonly number[] = [0, 1, 2, 3];
export const CHANCE_OPTIONS: readonly number[] = [15, 30, 45, 60];

export const DEFAULT_CUSTOM: CustomRules = {
  roundSeconds: CLASSIC_RULES.roundSeconds,
  startBombs: CLASSIC_RULES.startBombs,
  startRange: CLASSIC_RULES.startRange,
  startSpeed: CLASSIC_RULES.startSpeedLevel,
  powerupChance: CLASSIC_RULES.powerupChance,
  powerups: Array.from({ length: PICKUP_KIND_COUNT }, () => 2 as PowerLevel),
  suddenDeath: 'spiral',
  ghosts: true,
};

/** Weight multipliers (in halves) per level. */
const HALVES: Readonly<Record<PowerLevel, number>> = { 0: 0, 1: 1, 2: 2, 3: 4 };

/** `base` weights scaled per kind by `levels`; an enabled kind keeps at least weight 1. */
export function scaleWeights(
  base: readonly number[],
  levels: readonly PowerLevel[],
): number[] | null {
  const out = base.map((w, i) => {
    const level = levels[i] ?? 2;
    if (level === 0) return 0;
    return Math.max(1, Math.round((w * HALVES[level]) / 2));
  });
  return out.some((w) => w > 0) ? out : null;
}

/** Are all power-ups switched off? */
export function noPowerups(custom: CustomRules): boolean {
  return custom.powerups.every((l) => l === 0);
}

/** The core rules of a custom setup (`winsToMatch` comes from the party config). */
export function customToRules(custom: CustomRules, winsToMatch: number): Rules {
  const weights = scaleWeights(DEFAULT_POWERUP_WEIGHTS, custom.powerups);
  return {
    ...CLASSIC_RULES,
    roundSeconds: custom.roundSeconds,
    startBombs: custom.startBombs,
    startRange: custom.startRange,
    startSpeedLevel: custom.startSpeed,
    powerupChance: weights ? custom.powerupChance : 0,
    powerupWeights: weights ?? DEFAULT_POWERUP_WEIGHTS,
    suddenDeath: custom.suddenDeath,
    ghosts: custom.ghosts,
    winsToMatch,
  };
}

/**
 * An arena with its own power-up weights would ignore the rules' weights (core: the arena's take
 * precedence), so custom frequencies are applied to them here.
 */
export function customArena(arena: ArenaDef, custom: CustomRules): ArenaDef {
  if (!arena.powerupWeights) return arena;
  const weights = scaleWeights(arena.powerupWeights, custom.powerups);
  return weights ? { ...arena, powerupWeights: weights } : arena;
}

function pick<T>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Validates an untrusted stored value field by field. */
export function sanitizeCustom(raw: unknown): CustomRules {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CUSTOM;
  const levels = Array.isArray(o.powerups) ? o.powerups : [];
  return {
    roundSeconds: pick(o.roundSeconds, ROUND_OPTIONS, d.roundSeconds),
    startBombs: pick(o.startBombs, START_BOMB_OPTIONS, d.startBombs),
    startRange: pick(o.startRange, START_RANGE_OPTIONS, d.startRange),
    startSpeed: pick(o.startSpeed, START_SPEED_OPTIONS, d.startSpeed),
    powerupChance: pick(o.powerupChance, CHANCE_OPTIONS, d.powerupChance),
    powerups: d.powerups.map((fallback, i) => pick(levels[i], POWER_LEVELS, fallback)),
    suddenDeath: o.suddenDeath === 'none' ? 'none' : 'spiral',
    ghosts: o.ghosts !== false,
  };
}
