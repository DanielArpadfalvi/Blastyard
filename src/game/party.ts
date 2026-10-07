/**
 * Party setup (T5.1, PLAN §1.3 / §1.6): who sits where, which rules, which arena. A
 * {@link PartyConfig} is what the setup screen edits; {@link resolveParty} turns it into the
 * {@link PartyPlan} a session plays (seat plan with orientations, rules, teams, zone layout) and
 * {@link partyMatchSetup} into the core's `MatchSetup`.
 *
 * Layouts: a lone human in seat 0 holds the device with both thumbs (`solo`); otherwise the
 * players sit face to face (`faceoff`: seats 0 and 1 own the two strips) or at four corners
 * (`corners`: one corner zone per seat, one finger each). Everything but "who is human" is free:
 * the seat kinds are human, bot (four difficulties) or off. 2v2 pairs the seats that share a
 * side of the table. Pure: no DOM, no Pixi.
 */

import { ALL_ARENAS, FREE_ARENAS, arenaById, isPlusArena } from '../content/arenas';
import {
  BotLevel,
  RULE_PRESETS,
  WINS_TO_MATCH_OPTIONS,
  type ArenaDef,
  type MatchSetup,
  type PresetId,
  type Rules,
} from '../core';
import { nextOrientation, type SeatOrientation } from '../input/rotation';
import type { LayoutKind, SeatKind, SeatPlan } from './modes';

export type PartyLayout = 'faceoff' | 'corners';

export interface PartySeat {
  readonly kind: SeatKind;
  /** `BotLevel` 1–4, used when `kind` is `bot`. */
  readonly level: number;
}

export interface PartyConfig {
  /** Layout for two or more players (a lone human in seat 0 always plays `solo`). */
  readonly layout: PartyLayout;
  /** Exactly `MAX_SEATS` entries. */
  readonly seats: readonly PartySeat[];
  /** Per seat: a player-chosen orientation (lobby arrow), `null` = the layout default. */
  readonly orientations: readonly (SeatOrientation | null)[];
  readonly preset: PresetId;
  /** Rounds needed to win the match (1, 3 or 5). */
  readonly winsToMatch: number;
  /** 2v2 (needs all four seats in play). */
  readonly teams: boolean;
  /** An arena id, or `random` (a free / owned arena per match). */
  readonly arena: string;
}

export const RANDOM_ARENA = 'random';

const HUMAN: PartySeat = { kind: 'human', level: BotLevel.NORMAL };
const OFF: PartySeat = { kind: 'off', level: BotLevel.NORMAL };

export const DEFAULT_PARTY: PartyConfig = {
  layout: 'faceoff',
  seats: [HUMAN, HUMAN, OFF, OFF],
  orientations: [null, null, null, null],
  preset: 'classic',
  winsToMatch: 3,
  teams: false,
  arena: RANDOM_ARENA,
};

/** Default orientation of each seat per layout (PLAN §1.3: towards the centre / nearest side). */
const DEFAULT_ORIENTATION: Readonly<Record<LayoutKind, readonly SeatOrientation[]>> = {
  solo: [0, 0, 0, 0],
  faceoff: [90, 270, 0, 0],
  corners: [180, 180, 0, 0],
  attract: [0, 0, 0, 0],
};

/** What a seat cycles through when its card is tapped. */
export function seatChoices(layout: PartyLayout, seat: number): readonly PartySeat[] {
  const bots: PartySeat[] = [
    { kind: 'bot', level: BotLevel.EASY },
    { kind: 'bot', level: BotLevel.NORMAL },
    { kind: 'bot', level: BotLevel.HARD },
    { kind: 'bot', level: BotLevel.EXPERT },
  ];
  // Face-off: only the two strips have a control zone, so seats 3 and 4 cannot be human.
  const human = layout === 'faceoff' && seat >= 2 ? [] : [HUMAN];
  return [...human, ...bots, OFF];
}

function humans(seats: readonly PartySeat[]): number {
  return seats.filter((s) => s.kind === 'human').length;
}

function sameSeat(a: PartySeat, b: PartySeat): boolean {
  return a.kind === b.kind && (a.kind !== 'bot' || a.level === b.level);
}

/** A config with at least one human and at least two seats in play. */
export function isPlayable(config: PartyConfig): boolean {
  const inPlay = config.seats.filter((s) => s.kind !== 'off').length;
  return humans(config.seats) >= 1 && inPlay >= 2;
}

/** Steps `seat` to its next kind (human → bots Easy…Expert → off), skipping unplayable setups. */
export function cycleSeat(config: PartyConfig, seat: number): PartyConfig {
  const choices = seatChoices(config.layout, seat);
  const at = choices.findIndex((c) => sameSeat(c, config.seats[seat] as PartySeat));
  for (let k = 1; k <= choices.length; k++) {
    const next = choices[(at + k) % choices.length] as PartySeat;
    const seats = config.seats.map((s, i) => (i === seat ? next : s));
    const candidate = withSeats(config, seats);
    if (isPlayable(candidate)) return candidate;
  }
  return config;
}

function withSeats(config: PartyConfig, seats: readonly PartySeat[]): PartyConfig {
  // 2v2 only makes sense with all four seats in play.
  const full = seats.every((s) => s.kind !== 'off');
  return { ...config, seats, teams: config.teams && full };
}

/** Switches the layout; seats that cannot be human in face-off become bots, orientations reset. */
export function setLayout(config: PartyConfig, layout: PartyLayout): PartyConfig {
  const seats = config.seats.map((s, i) =>
    layout === 'faceoff' && i >= 2 && s.kind === 'human'
      ? { kind: 'bot' as const, level: BotLevel.NORMAL }
      : s,
  );
  const next = withSeats({ ...config, layout, orientations: [null, null, null, null] }, seats);
  return isPlayable(next) ? next : config;
}

export function setPreset(config: PartyConfig, preset: PresetId): PartyConfig {
  return { ...config, preset };
}

export function setWins(config: PartyConfig, winsToMatch: number): PartyConfig {
  return WINS_TO_MATCH_OPTIONS.includes(winsToMatch) ? { ...config, winsToMatch } : config;
}

export function setTeams(config: PartyConfig, teams: boolean): PartyConfig {
  return { ...config, teams: teams && config.seats.every((s) => s.kind !== 'off') };
}

export function setArena(config: PartyConfig, arena: string): PartyConfig {
  return arena === RANDOM_ARENA || arenaById(arena) ? { ...config, arena } : config;
}

/** The resolved plan of a party: what a session plays. */
export interface PartyPlan {
  readonly layout: LayoutKind;
  readonly seats: readonly SeatPlan[];
  readonly rules: Rules;
  /** Team per seat (2v2), or `null` for free-for-all. */
  readonly teams: readonly number[] | null;
}

export function resolveParty(config: PartyConfig): PartyPlan {
  const layout: PartyLayout = config.layout;
  const seats = config.seats.map((s, i) =>
    layout === 'faceoff' && i >= 2 && s.kind === 'human' ? { ...s, kind: 'bot' as const } : s,
  );
  const kind: LayoutKind = humans(seats) === 1 && seats[0]?.kind === 'human' ? 'solo' : layout;
  const plan: SeatPlan[] = seats.map((s, seat) => ({
    seat,
    kind: s.kind,
    orientation:
      kind === 'solo'
        ? 0
        : (config.orientations[seat] ?? (DEFAULT_ORIENTATION[kind][seat] as SeatOrientation)),
    ...(s.kind === 'bot' ? { botLevel: s.level } : {}),
  }));
  const full = seats.every((s) => s.kind !== 'off');
  const teams = config.teams && full ? (kind === 'corners' ? [0, 0, 1, 1] : [0, 1, 0, 1]) : null;
  return {
    layout: kind,
    seats: plan,
    rules: { ...RULE_PRESETS[config.preset], winsToMatch: config.winsToMatch },
    teams,
  };
}

/** Turns a seat's orientation by 90° (the lobby arrow); a lone solo holder has no arrow. */
export function turnSeat(config: PartyConfig, seat: number): PartyConfig {
  const plan = resolveParty(config);
  if (plan.layout === 'solo') return config;
  const current = (plan.seats[seat] as SeatPlan).orientation;
  const orientations = config.orientations.map((o, i) =>
    i === seat ? nextOrientation(current) : o,
  );
  return { ...config, orientations };
}

/** The core setup of a party match (`warmup`: the lobby sandbox, bots stand still). */
export function partyMatchSetup(
  plan: PartyPlan,
  seed: number,
  arena: ArenaDef,
  warmup = false,
): MatchSetup {
  return {
    seed,
    arena,
    seats: plan.seats.map((p) => p.kind !== 'off'),
    bots: plan.seats.map((p) =>
      p.kind === 'bot' && !warmup ? (p.botLevel ?? BotLevel.NORMAL) : BotLevel.NONE,
    ),
    rules: plan.rules,
    ...(plan.teams ? { teams: plan.teams } : {}),
    ...(warmup ? { warmup: true } : {}),
  };
}

/** Is `arena` playable with the given entitlement? */
export function arenaUnlocked(arena: ArenaDef, hasPlus: boolean): boolean {
  return hasPlus || !isPlusArena(arena);
}

/** Arenas a `random` choice may pick from. */
export function randomPool(hasPlus: boolean): readonly ArenaDef[] {
  return hasPlus ? ALL_ARENAS : FREE_ARENAS;
}

/**
 * The arena of match number `n`: the chosen one (when owned), or a rotation / seeded pick from
 * the pool. A locked choice falls back to the pool so a stale config never plays Plus content.
 */
export function pickArena(config: PartyConfig, hasPlus: boolean, seed: number): ArenaDef {
  const chosen = arenaById(config.arena);
  if (chosen && arenaUnlocked(chosen, hasPlus)) return chosen;
  const pool = randomPool(hasPlus);
  return pool[(seed >>> 0) % pool.length] as ArenaDef;
}
