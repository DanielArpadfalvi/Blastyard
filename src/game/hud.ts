/**
 * HUD model: the few numbers the match HUD shows, derived from the (read-only) state. The DOM
 * HUD only re-renders when {@link hudKey} changes, which happens a few times per second at most
 * (clock seconds, pickups, phase changes) – not every frame.
 *
 * Pure: no DOM, no Pixi.
 */

import { Hdr, MAX_SEATS, NO_SIDE, Phase, RuleFlag } from '../core';
import type { ReadonlySimState } from '../render/readonlyState';

/** "Go!" stays up this long after a round starts (ticks). */
export const GO_TICKS = 45;
/** Ticks between the match end and the result screen (the last blast stays visible). */
export const RESULT_DELAY_TICKS = 90;

export interface SeatHud {
  readonly seat: number;
  readonly active: boolean;
  readonly alive: boolean;
  readonly ghost: boolean;
  /** Pop capacity, flame range and Roller level. */
  readonly bombs: number;
  readonly range: number;
  readonly speed: number;
  /** Rounds won by this seat's side. */
  readonly wins: number;
}

export type HudBanner =
  | { readonly kind: 'none' }
  | { readonly kind: 'countdown'; readonly value: number }
  | { readonly kind: 'go' }
  | { readonly kind: 'suddenDeath' }
  | { readonly kind: 'roundOver'; readonly winner: number };

export interface HudModel {
  readonly phase: number;
  readonly round: number;
  readonly winsToMatch: number;
  /** Whole seconds left on the round clock (rounded up); 0 in sudden death. */
  readonly seconds: number;
  readonly suddenDeath: boolean;
  readonly banner: HudBanner;
  /** Winning side of the match, `NO_SIDE` while undecided. */
  readonly matchWinner: number;
  readonly seats: readonly SeatHud[];
}

/** `m:ss` clock text. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sideOf(state: ReadonlySimState, seat: number): number {
  return ((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.TEAMS) !== 0
    ? (state.team[seat] as number)
    : seat;
}

export function hudModel(state: ReadonlySimState): HudModel {
  const hdr = state.hdr;
  const phase = hdr[Hdr.PHASE] as number;
  const roundTicks = hdr[Hdr.ROUND_TICKS] as number;
  const timeLeft = hdr[Hdr.ROUND_TIME] as number;
  const suddenDeath = phase === Phase.PLAYING && roundTicks > 0 && timeLeft <= 0;
  let banner: HudBanner = { kind: 'none' };
  if (phase === Phase.COUNTDOWN) {
    banner = {
      kind: 'countdown',
      value: Math.max(1, Math.ceil((hdr[Hdr.PHASE_TIMER] as number) / 60)),
    };
  } else if (phase === Phase.PLAYING) {
    if (roundTicks > 0 && roundTicks - timeLeft < GO_TICKS) banner = { kind: 'go' };
    else if (suddenDeath && (hdr[Hdr.SD_INDEX] as number) < 4) banner = { kind: 'suddenDeath' };
  } else {
    banner = { kind: 'roundOver', winner: hdr[Hdr.ROUND_WINNER] as number };
  }
  const mask = hdr[Hdr.SEAT_MASK] as number;
  const seats: SeatHud[] = [];
  for (let s = 0; s < MAX_SEATS; s++) {
    const active = (mask & (1 << s)) !== 0;
    seats.push({
      seat: s,
      active,
      alive: active && (state.alive[s] as number) !== 0,
      ghost: active && (state.ghost[s] as number) !== 0,
      bombs: state.bombCap[s] as number,
      range: state.range[s] as number,
      speed: state.speedLvl[s] as number,
      wins: active ? (state.wins[sideOf(state, s)] as number) : 0,
    });
  }
  return {
    phase,
    round: hdr[Hdr.ROUND] as number,
    winsToMatch: hdr[Hdr.WINS_TO_MATCH] as number,
    seconds: Math.ceil(Math.max(0, timeLeft) / 60),
    suddenDeath,
    banner,
    matchWinner: phase === Phase.MATCH_OVER ? (hdr[Hdr.MATCH_WINNER] as number) : NO_SIDE,
    seats,
  };
}

/** Change-detection key: equal keys ⇒ the HUD looks the same. */
export function hudKey(m: HudModel): string {
  const b = m.banner;
  const banner =
    b.kind === 'countdown' ? `c${b.value}` : b.kind === 'roundOver' ? `r${b.winner}` : b.kind;
  const seats = m.seats
    .map((s) => `${+s.active}${+s.alive}${+s.ghost}.${s.bombs}.${s.range}.${s.speed}.${s.wins}`)
    .join('|');
  return `${m.phase}/${m.round}/${m.seconds}/${+m.suddenDeath}/${banner}/${m.matchWinner}/${seats}`;
}
