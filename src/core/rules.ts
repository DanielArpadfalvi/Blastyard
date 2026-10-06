/**
 * Match rules and the built-in presets (PLAN §1.1, §1.6, §3.1).
 *
 * Rules are fixed for a whole match and are copied into the state header by `createState`, so a
 * replay only needs the seed, the arena, the seats and these rules.
 */

import { DEFAULT_POWERUP_CHANCE, DEFAULT_POWERUP_WEIGHTS } from './arena';

export interface Rules {
  readonly startBombs: number;
  readonly startRange: number;
  readonly startSpeedLevel: number;
  /** Percent chance that a crate hides a power-up. */
  readonly powerupChance: number;
  /** Weights per `Pickup` kind − 1 (length 9); an arena's own weights take precedence. */
  readonly powerupWeights: readonly number[];
  /** Playing time before sudden death, in seconds (0 = no time limit). */
  readonly roundSeconds: number;
  /** Round wins needed to take the match (first to N: 1, 3 or 5). */
  readonly winsToMatch: number;
  /** What happens when the round time runs out: the closing spiral, or a drawn round. */
  readonly suddenDeath: 'spiral' | 'none';
  /** Eliminated players haunt the outer wall and drop revenge bombs. */
  readonly ghosts: boolean;
  /** Team mode only: may teammates' flames hurt you? (Your own flames always do.) */
  readonly friendlyFire: boolean;
}

/** Kept for callers written against the T1.1–T1.3 API. */
export type CoreRules = Rules;

export type PresetId = 'classic' | 'fast' | 'chaos';

export const CLASSIC_RULES: Rules = {
  startBombs: 1,
  startRange: 2,
  startSpeedLevel: 0,
  powerupChance: DEFAULT_POWERUP_CHANCE,
  powerupWeights: DEFAULT_POWERUP_WEIGHTS,
  roundSeconds: 120,
  winsToMatch: 3,
  suddenDeath: 'spiral',
  ghosts: true,
  friendlyFire: false,
};

/** Fast: 90 s rounds, two bombs from the start. */
export const FAST_RULES: Rules = {
  ...CLASSIC_RULES,
  roundSeconds: 90,
  startBombs: 2,
};

/** Chaos: 45% power-up chance and the Jinx curse three times as common. */
export const CHAOS_RULES: Rules = {
  ...CLASSIC_RULES,
  powerupChance: 45,
  powerupWeights: [26, 26, 16, 8, 6, 5, 5, 3, 15],
};

export const RULE_PRESETS: Readonly<Record<PresetId, Rules>> = {
  classic: CLASSIC_RULES,
  fast: FAST_RULES,
  chaos: CHAOS_RULES,
};

export const DEFAULT_RULES: Rules = CLASSIC_RULES;

/** Allowed values of `winsToMatch` offered by the UI. */
export const WINS_TO_MATCH_OPTIONS: readonly number[] = [1, 3, 5];
