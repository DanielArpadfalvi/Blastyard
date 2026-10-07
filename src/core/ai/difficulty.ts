/**
 * Bot difficulty profiles (PLAN §1.10) and the per-seat bot configuration stored in the state
 * header (`Hdr.BOT_CFG`, 3 bits per seat). A seat with level 0 is a human (or empty) seat.
 */

import { Hdr, type SimState } from '../state';

export const BotLevel = {
  NONE: 0,
  EASY: 1,
  NORMAL: 2,
  HARD: 3,
  EXPERT: 4,
} as const;
export type BotLevelId = (typeof BotLevel)[keyof typeof BotLevel];

export interface BotProfile {
  /** Ticks between two goal decisions (emergencies are re-decided at once). */
  readonly interval: number;
  /**
   * Reaction delay in ticks: a bomb somebody else dropped is only noticed once it has burnt this
   * long.
   */
  readonly reaction: number;
  /** Chance in permille that an escape decision picks a wrong target. */
  readonly mistakePermille: number;
  /** 0–100: eagerness to hunt opponents (attack spots, chasing). */
  readonly aggression: number;
  /** Does the danger map propagate chain reactions? */
  readonly chain: boolean;
  readonly kick: boolean;
  readonly toss: boolean;
  /**
   * 0 = never plans traps, 1 = places bombs that leave an opponent in a blast line without an
   * escape, 2 = also plans through chain reactions and from off-line cells (2-step traps).
   */
  readonly trap: 0 | 1 | 2;
}

const PROFILES: readonly BotProfile[] = [
  // NONE (placeholder so the table is indexable by level)
  {
    interval: 12,
    reaction: 24,
    mistakePermille: 0,
    aggression: 0,
    chain: false,
    kick: false,
    toss: false,
    trap: 0,
  },
  {
    interval: 12,
    reaction: 24,
    mistakePermille: 80,
    aggression: 30,
    chain: false,
    kick: false,
    toss: false,
    trap: 0,
  },
  {
    interval: 8,
    reaction: 15,
    mistakePermille: 50,
    aggression: 60,
    chain: true,
    kick: true,
    toss: false,
    trap: 0,
  },
  {
    interval: 6,
    reaction: 7,
    mistakePermille: 15,
    aggression: 80,
    chain: true,
    kick: true,
    toss: true,
    trap: 1,
  },
  {
    interval: 4,
    reaction: 3,
    mistakePermille: 3,
    aggression: 90,
    chain: true,
    kick: true,
    toss: true,
    trap: 2,
  },
];

export function botProfile(level: number): BotProfile {
  return PROFILES[Math.min(Math.max(level, 0), 4)] as BotProfile;
}

/** Bot level of `seat` (0 = not a bot). */
export function botLevel(state: SimState, seat: number): number {
  return ((state.hdr[Hdr.BOT_CFG] as number) >> (seat * 3)) & 7;
}

/** Makes `seat` a bot of `level` (0 = human). */
export function setBotLevel(state: SimState, seat: number, level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > 4) {
    throw new RangeError('bot level must be an integer 0–4');
  }
  const cleared = (state.hdr[Hdr.BOT_CFG] as number) & ~(7 << (seat * 3));
  state.hdr[Hdr.BOT_CFG] = cleared | (level << (seat * 3));
}

/** Does any seat run a bot? */
export function hasBots(state: SimState): boolean {
  return (state.hdr[Hdr.BOT_CFG] as number) !== 0;
}
