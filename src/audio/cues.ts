/**
 * Sound event mapping (T3.2): simulation events and the per-tick bomb fuses → sound cues.
 *
 * Pure (no Web Audio): the engine turns cues into synthesized sounds. Several events of the same
 * kind in one tick (a chain reaction, a row of crates) collapse into one louder cue, so a big
 * chain sounds big without stacking dozens of voices.
 */

import { BombFlag, EventKind, GRID_W, Hdr, NO_SIDE, Phase, TILE, type SimEvent } from '../core';
import type { ReadonlySimState } from '../render/readonlyState';

export const CueId = {
  COUNTDOWN: 'countdown',
  GO: 'go',
  PLACE: 'place',
  BLAST: 'blast',
  CRATE: 'crate',
  PICKUP: 'pickup',
  BURN: 'burn',
  DEATH: 'death',
  SUDDEN_DEATH: 'suddenDeath',
  BLOCK_DROP: 'blockDrop',
  GHOST_BOMB: 'ghostBomb',
  ROUND_WIN: 'roundWin',
  ROUND_DRAW: 'roundDraw',
  MATCH_END: 'matchEnd',
  FUSE_BEEP: 'fuseBeep',
} as const;
export type CueId = (typeof CueId)[keyof typeof CueId];

export interface Cue {
  readonly id: CueId;
  /** Loudness / size 0–1. */
  readonly intensity: number;
  /** Cue-specific variant (countdown number, beep step, pickup kind…). */
  readonly variant: number;
  /** Stereo position −1 (left) … 1 (right). */
  readonly pan: number;
}

/** Fuse ticks left at which a pop beeps: the final 0.5 s, speeding up. */
export const FUSE_BEEP_TICKS: readonly number[] = [30, 22, 15, 9, 4];

/** Stereo pan of a grid cell (the arena centre is 0; ±0.6 at the walls). */
export function panOfCell(cell: number): number {
  if (cell < 0) return 0;
  const x = cell % GRID_W;
  return Math.round(((x - (GRID_W - 1) / 2) / ((GRID_W - 1) / 2)) * 0.6 * 100) / 100;
}

/** Event kind → cue (null: silent). Pure lookup used by {@link cuesForEvents}. */
export function cueIdFor(e: SimEvent): CueId | null {
  switch (e.kind) {
    case EventKind.COUNTDOWN:
      return CueId.COUNTDOWN;
    case EventKind.ROUND_START:
      return CueId.GO;
    case EventKind.BOMB_PLACED:
    case EventKind.BOMB_TOSSED:
    case EventKind.BOMB_KICKED:
      return CueId.PLACE;
    case EventKind.BOMB_EXPLODED:
      return CueId.BLAST;
    case EventKind.CRATE_DESTROYED:
    case EventKind.PICKUP_DROPPED:
      return CueId.CRATE;
    case EventKind.PICKUP_COLLECTED:
    case EventKind.JINX_CAUGHT:
    case EventKind.JINX_PASSED:
    case EventKind.TELEPORTED:
      return CueId.PICKUP;
    case EventKind.PICKUP_BURNED:
    case EventKind.SHIELD_BROKEN:
    case EventKind.MONSTER_KILLED:
      return CueId.BURN;
    case EventKind.DEATH:
      return CueId.DEATH;
    case EventKind.SUDDEN_DEATH:
      return CueId.SUDDEN_DEATH;
    case EventKind.BLOCK_DROPPED:
    case EventKind.PILLAR_GROWN:
      return CueId.BLOCK_DROP;
    case EventKind.GHOST_BOMB:
      return CueId.GHOST_BOMB;
    case EventKind.ROUND_END:
      return e.value === NO_SIDE ? CueId.ROUND_DRAW : CueId.ROUND_WIN;
    case EventKind.MATCH_END:
      return CueId.MATCH_END;
    default:
      return null;
  }
}

/** Loudness of `n` same-kind events in one tick. */
function stackIntensity(id: CueId, n: number): number {
  const base = id === CueId.BLAST ? 0.7 : id === CueId.CRATE ? 0.6 : 0.85;
  return Math.min(1, base + 0.12 * (n - 1));
}

/**
 * Cues for one tick's events, at most one per cue id (ordered by first occurrence). A match end
 * replaces the round-end cue of the same tick.
 */
export function cuesForEvents(events: readonly SimEvent[]): Cue[] {
  const order: CueId[] = [];
  const count = new Map<CueId, number>();
  const pan = new Map<CueId, number>();
  const variant = new Map<CueId, number>();
  for (const e of events) {
    const id = cueIdFor(e);
    if (id === null) continue;
    const n = count.get(id) ?? 0;
    if (n === 0) {
      order.push(id);
      pan.set(id, panOfCell(e.cell));
      variant.set(
        id,
        e.kind === EventKind.COUNTDOWN || e.kind === EventKind.PICKUP_COLLECTED ? e.value : 0,
      );
    } else {
      // Several sources: centre the sound between them.
      pan.set(id, ((pan.get(id) as number) * n + panOfCell(e.cell)) / (n + 1));
    }
    count.set(id, n + 1);
  }
  const ids = order.includes(CueId.MATCH_END)
    ? order.filter((id) => id !== CueId.ROUND_WIN && id !== CueId.ROUND_DRAW)
    : order;
  return ids.map((id) => ({
    id,
    intensity: stackIntensity(id, count.get(id) as number),
    variant: variant.get(id) as number,
    pan: Math.round((pan.get(id) as number) * 100) / 100,
  }));
}

/**
 * Fuse beeps due in the current tick: one cue for the pop closest to going off whose remaining
 * fuse is on a beep tick (`variant` = beep step 0…4, rising pitch). Silent outside play.
 */
export function fuseBeepCue(state: ReadonlySimState): Cue | null {
  if ((state.hdr[Hdr.PHASE] as number) !== Phase.PLAYING) return null;
  const n = state.hdr[Hdr.BOMB_COUNT] as number;
  let best = -1;
  let bestCell = -1;
  for (let b = 0; b < n; b++) {
    const step = FUSE_BEEP_TICKS.indexOf(state.bombFuse[b] as number);
    if (step > best) {
      best = step;
      const x = Math.floor((state.bombX[b] as number) / TILE);
      const y = Math.floor((state.bombY[b] as number) / TILE);
      bestCell = y * GRID_W + x;
    }
  }
  if (best < 0) return null;
  return { id: CueId.FUSE_BEEP, intensity: 0.5, variant: best, pan: panOfCell(bestCell) };
}

/**
 * Fuse sizzle level 0–1 for the looping hiss: grows with the number of lit pops (ghost pops
 * count half), silent outside play.
 */
export function sizzleLevel(state: ReadonlySimState): number {
  if ((state.hdr[Hdr.PHASE] as number) !== Phase.PLAYING) return 0;
  const n = state.hdr[Hdr.BOMB_COUNT] as number;
  let lit = 0;
  for (let b = 0; b < n; b++) {
    lit += ((state.bombFlags[b] as number) & BombFlag.GHOST) !== 0 ? 0.5 : 1;
  }
  return lit <= 0 ? 0 : Math.min(1, 0.35 + 0.15 * lit);
}
