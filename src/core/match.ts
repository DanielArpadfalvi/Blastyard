/**
 * Match flow: (re)starting rounds from the layout stored in the state, scoring and match end.
 *
 * Every round rebuilds the arena from `state.layout` with the state's own ARENA / LOOT streams
 * (so each round gets a fresh crate and pickup layout), puts the active seats back on their spawn
 * cells with the starting stats from the rules, and runs the countdown. A decided round adds a
 * win to the winning side (draws score nothing); the first side to `WINS_TO_MATCH` wins takes the
 * match and the state freezes in MATCH_OVER. Otherwise the next round starts `ROUND_END_TICKS`
 * later.
 */

import { fillArena } from './arena';
import { clearBombs } from './bombs';
import { EventKind, type EventSink } from './events';
import { Dir } from './input';
import { COUNTDOWN_TICKS, ROUND_END_TICKS } from './round';
import {
  GRID_W,
  Hdr,
  MAX_SEATS,
  NO_GOAL,
  NO_OWNER,
  NO_SIDE,
  Phase,
  isSeatActive,
  tileCenter,
} from './state';
import type { SimState } from './state';

/** Resets the arena and the seats for the next round and starts its countdown. */
export function startRound(state: SimState): void {
  const hdr = state.hdr;
  fillArena(
    state,
    { cells: state.layout },
    {
      crateDensity: hdr[Hdr.CRATE_DENSITY] as number,
      powerupChance: hdr[Hdr.POWERUP_CHANCE] as number,
      powerupWeights: state.weights,
    },
  );
  clearBombs(state);
  for (let s = 0; s < MAX_SEATS; s++) {
    state.ghost[s] = 0;
    state.ghostCd[s] = 0;
    state.bombBuffer[s] = 0;
    state.abilities[s] = 0;
    state.jinx[s] = 0;
    state.jinxCd[s] = 0;
    state.aiTimer[s] = 0;
    state.aiGoal[s] = NO_GOAL;
    state.aiMode[s] = 0;
    state.jinxTicks[s] = 0;
    state.invuln[s] = 0;
    state.moveDir[s] = Dir.NONE;
    state.slideLeft[s] = 0;
    state.tpLock[s] = 0;
    if (!isSeatActive(state, s)) continue;
    const cell = state.spawnCell[s] as number;
    const x = cell % GRID_W;
    state.px[s] = tileCenter(x);
    state.py[s] = tileCenter((cell - x) / GRID_W);
    state.alive[s] = 1;
    state.facing[s] = Dir.DOWN;
    state.abilities[s] = hdr[Hdr.START_ABILITIES] as number;
    state.bombCap[s] = hdr[Hdr.START_BOMBS] as number;
    state.range[s] = hdr[Hdr.START_RANGE] as number;
    state.speedLvl[s] = hdr[Hdr.START_SPEED] as number;
  }
  hdr[Hdr.ROUND] = (hdr[Hdr.ROUND] as number) + 1;
  hdr[Hdr.ROUND_TIME] = hdr[Hdr.ROUND_TICKS] as number;
  hdr[Hdr.SD_INDEX] = 0;
  hdr[Hdr.SD_TIMER] = 0;
  hdr[Hdr.GROW_TIMER] = 0;
  hdr[Hdr.ROUND_WINNER] = NO_SIDE;
  hdr[Hdr.PHASE] = Phase.COUNTDOWN;
  hdr[Hdr.PHASE_TIMER] = COUNTDOWN_TICKS;
}

/** Records the outcome of a round (`winner` side or `NO_SIDE`) and moves to the next phase. */
export function endRound(state: SimState, winner: number, sink: EventSink): void {
  const hdr = state.hdr;
  hdr[Hdr.ROUND_WINNER] = winner;
  for (let s = 0; s < MAX_SEATS; s++) state.bombBuffer[s] = 0;
  sink.emit(EventKind.ROUND_END, NO_OWNER, -1, winner);
  if (winner !== NO_SIDE) {
    const wins = (state.wins[winner] as number) + 1;
    state.wins[winner] = wins;
    if (wins >= Math.max(1, hdr[Hdr.WINS_TO_MATCH] as number)) {
      hdr[Hdr.MATCH_WINNER] = winner;
      hdr[Hdr.PHASE] = Phase.MATCH_OVER;
      hdr[Hdr.PHASE_TIMER] = 0;
      sink.emit(EventKind.MATCH_END, NO_OWNER, -1, winner);
      return;
    }
  }
  hdr[Hdr.PHASE] = Phase.ROUND_OVER;
  hdr[Hdr.PHASE_TIMER] = ROUND_END_TICKS;
}

/** Is the match decided? */
export function isMatchOver(state: SimState): boolean {
  return state.hdr[Hdr.PHASE] === Phase.MATCH_OVER;
}
