/**
 * Online private lobby protocol (pure). Every phone in a lobby joins one realtime room named by a
 * six-character code; the creator is the host and owns the lobby state: it admits players (at
 * most four), tracks ready flags, picks the rules and starts the match by broadcasting one
 * {@link MatchStart} – from then on every phone runs the same deterministic simulation and only
 * input packets travel (see `rollback.ts`).
 *
 * No DOM, no transport: `hostReduce` is what the host does with a message, the rest are helpers
 * shared by host and guests.
 */

import { arenaById, FREE_ARENAS } from '../content/arenas';
import { BotLevel, MAX_SEATS, RULE_PRESETS, type MatchSetup, type PresetId } from '../core';
import type { InputPacket } from './rollback';

/** Lobby codes: no 0/O, 1/I/L – easy to read out loud and type. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const MAX_PLAYERS = MAX_SEATS;
export const NAME_MAX = 16;

export function makeCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return code;
}

/** Cleans typed input (case, spaces, dashes); null unless it is a valid code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

/** A display name: trimmed, single-spaced, at most `NAME_MAX` characters; null when empty. */
export function cleanName(input: string): string | null {
  const name = input.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

export interface LobbyMember {
  readonly id: string;
  readonly name: string;
  readonly ready: boolean;
}

export interface LobbyRules {
  readonly preset: PresetId;
  readonly winsToMatch: number;
  /** An arena id, or `random`. */
  readonly arena: string;
  /** Empty seats play as bots of this level (0 = stay empty). */
  readonly bots: number;
}

export const DEFAULT_LOBBY_RULES: LobbyRules = {
  preset: 'classic',
  winsToMatch: 3,
  arena: 'random',
  bots: 0,
};

export interface LobbyState {
  readonly code: string;
  readonly hostId: string;
  /** In join order; the index is the seat. */
  readonly members: readonly LobbyMember[];
  readonly rules: LobbyRules;
  /** Bumped on every change (guests keep the newest). */
  readonly version: number;
}

/** What every phone needs to build the identical match. */
export interface MatchStart {
  readonly seed: number;
  readonly arena: string;
  readonly preset: PresetId;
  readonly winsToMatch: number;
  /** Member id per seat (`null` = empty or bot). */
  readonly seats: readonly (string | null)[];
  /** Bot level per seat (0 = no bot). */
  readonly bots: readonly number[];
  /** Match number in this lobby (stale input packets of an earlier match are ignored). */
  readonly round: number;
}

export type NetMessage =
  | { readonly t: 'hello'; readonly from: string; readonly name: string }
  | { readonly t: 'state'; readonly lobby: LobbyState }
  | { readonly t: 'ready'; readonly from: string; readonly ready: boolean }
  | { readonly t: 'leave'; readonly from: string }
  | { readonly t: 'ping'; readonly from: string }
  | { readonly t: 'full'; readonly to: string }
  | { readonly t: 'start'; readonly match: MatchStart }
  | { readonly t: 'input'; readonly round: number; readonly packet: InputPacket }
  | {
      readonly t: 'hash';
      readonly round: number;
      readonly from: string;
      readonly tick: number;
      readonly hash: number;
    }
  | { readonly t: 'drop'; readonly round: number; readonly seat: number; readonly tick: number }
  | { readonly t: 'closed' };

export function newLobby(code: string, host: { id: string; name: string }): LobbyState {
  return {
    code,
    hostId: host.id,
    members: [{ id: host.id, name: host.name, ready: false }],
    rules: DEFAULT_LOBBY_RULES,
    version: 1,
  };
}

const bump = (s: LobbyState, patch: Partial<LobbyState>): LobbyState => ({
  ...s,
  ...patch,
  version: s.version + 1,
});

/** The host's lobby after `msg` (unchanged when it does not apply). */
export function hostReduce(state: LobbyState, msg: NetMessage): LobbyState {
  switch (msg.t) {
    case 'hello': {
      const name = cleanName(msg.name) ?? '?';
      const at = state.members.findIndex((m) => m.id === msg.from);
      if (at >= 0) {
        if (state.members[at]!.name === name) return state;
        return bump(state, {
          members: state.members.map((m, i) => (i === at ? { ...m, name } : m)),
        });
      }
      if (state.members.length >= MAX_PLAYERS) return state;
      return bump(state, { members: [...state.members, { id: msg.from, name, ready: false }] });
    }
    case 'ready': {
      const at = state.members.findIndex((m) => m.id === msg.from);
      if (at < 0 || state.members[at]!.ready === msg.ready) return state;
      return bump(state, {
        members: state.members.map((m, i) => (i === at ? { ...m, ready: msg.ready } : m)),
      });
    }
    case 'leave': {
      if (msg.from === state.hostId) return state;
      if (!state.members.some((m) => m.id === msg.from)) return state;
      return bump(state, { members: state.members.filter((m) => m.id !== msg.from) });
    }
    default:
      return state;
  }
}

export function setRules(state: LobbyState, rules: Partial<LobbyRules>): LobbyState {
  return bump(state, { rules: { ...state.rules, ...rules } });
}

/** Everyone ready again after a match. */
export function resetReady(state: LobbyState): LobbyState {
  return bump(state, { members: state.members.map((m) => ({ ...m, ready: false })) });
}

/** Players in the match: the members, plus bots when they fill the empty seats. */
export function playerCount(state: LobbyState): number {
  return state.rules.bots > 0 ? MAX_PLAYERS : state.members.length;
}

/** The host may start once at least two take part and every guest is ready. */
export function canStart(state: LobbyState): boolean {
  if (playerCount(state) < 2) return false;
  return state.members.every((m) => m.id === state.hostId || m.ready);
}

export function matchStart(state: LobbyState, seed: number, round: number): MatchStart {
  const seats = Array.from({ length: MAX_PLAYERS }, (_, s) => state.members[s]?.id ?? null);
  const bots = seats.map((id) => (id === null && state.rules.bots > 0 ? state.rules.bots : 0));
  const pool = FREE_ARENAS;
  const arena =
    state.rules.arena !== 'random' && arenaById(state.rules.arena)
      ? state.rules.arena
      : (pool[(seed >>> 0) % pool.length] as { id: string }).id;
  return {
    seed,
    arena,
    preset: state.rules.preset,
    winsToMatch: state.rules.winsToMatch,
    seats,
    bots,
    round,
  };
}

/** The core setup every phone builds from the start message. */
export function onlineMatchSetup(start: MatchStart): MatchSetup {
  const arena =
    arenaById(start.arena) ?? (FREE_ARENAS[0] as NonNullable<ReturnType<typeof arenaById>>);
  return {
    seed: start.seed,
    arena,
    seats: start.seats.map((id, s) => id !== null || (start.bots[s] ?? 0) > 0),
    bots: start.bots.map((b, s) => (start.seats[s] === null && b > 0 ? b : BotLevel.NONE)),
    rules: { ...RULE_PRESETS[start.preset], winsToMatch: start.winsToMatch },
  };
}

/** Seats played by humans on phones. */
export function humanSeats(start: MatchStart): number[] {
  return start.seats.flatMap((id, s) => (id !== null ? [s] : []));
}

/** Rough validation of an untrusted message (anything malformed is dropped). */
export function isNetMessage(value: unknown): value is NetMessage {
  if (value === null || typeof value !== 'object') return false;
  const t = (value as { t?: unknown }).t;
  return (
    typeof t === 'string' &&
    [
      'hello',
      'state',
      'ready',
      'leave',
      'ping',
      'full',
      'start',
      'input',
      'hash',
      'drop',
      'closed',
    ].includes(t)
  );
}
