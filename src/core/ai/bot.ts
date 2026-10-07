/**
 * Bot AI (PLAN §1.10): runs inside `step`, so a match with bots is reproduced by its setup (seed,
 * arena, seats, rules, bot levels) and the human input log alone.
 *
 * `botInput(state, seat)` returns the input byte of one bot seat for this tick. It reads the
 * state and draws randomness only from the seat's own RNG stream (`RngStream.AI0 + seat`), and it
 * keeps its small memory (goal cell, mode, decision timer) in the state, so snapshots, rollback and
 * replays stay exact.
 *
 * Priorities, per tick:
 *  1. Survival – when the bot's cell burns within the danger window (`danger.ts`), it escapes:
 *     breadth-first search to the nearest cell that never burns. A wrong target is picked with the
 *     difficulty's mistake rate; if nothing safe is reachable it heads for the cell that burns
 *     last, and a Toss bot standing on its own bomb throws it away.
 *  2. Otherwise, every `interval` ticks, goals are scored over the reachable safe cells: power-ups,
 *     crates a bomb would break, opponents in a clear blast line (more with aggression, a lot more
 *     when the bomb would trap them with no escape), and drifting towards the nearest opponent.
 *     A bomb is only placed when a safe escape exists after the placement (safe-placement check,
 *     including chain reactions); candidates that fail are skipped.
 *  3. Ghosts glide along the wall and drop revenge bombs at random.
 */

import { bombCanEnter, bombsInUse } from '../bombs';
import { DIR_DX, DIR_DY, Dir, encodeInput, type Direction } from '../input';
import { CORNER_ASSIST, playerSpeed } from '../movement';
import { RngStream, randInt } from '../rng';
import {
  Ability,
  CELL_COUNT,
  GRID_W,
  Hdr,
  Jinx,
  MAX_SEATS,
  NO_GOAL,
  Phase,
  RuleFlag,
  TILE,
  Tile,
  isSeatActive,
  playerCell,
  sideOf,
  tileCenter,
  toTile,
  type SimState,
} from '../state';
import {
  NEIGHBOR,
  SAFE,
  bombGrid,
  computeDanger,
  dOwn,
  dStart,
  dist,
  firstDir,
  reached,
  reachedCells,
  search,
} from './danger';
import { botLevel, botProfile, type BotProfile } from './difficulty';

/** Bot modes (`aiMode`). */
const MODE_GOAL = 0;
const MODE_ESCAPE = 1;
/** Walking to a cell where a bomb is to be placed: decide again the moment it is reached. */
const MODE_BOMB = 2;

/** Off-centre distance (subunits) within which a bomb may be dropped. */
const DROP_WINDOW = 48;
/** Off-centre distance (subunits) the bot accepts when standing still. */
const SETTLE_SLACK = 16;
/** Escape length (steps) from which an opponent next to the route may wall it in. */
const LONG_ESCAPE = 2;
/** Ticks of margin kept when deciding whether to leave a cell that will burn. */
const SLACK = 30;
/** Opponents this close may wall in an escape route. */
const NEAR_OPPONENT = 6;
/** Score cost of one step of walking, and the random spread added to every cell's score. */
const STEP_COST = 10;
const JITTER = 6;
/** Search horizon in steps for goals. */
const GOAL_STEPS = 18;

const PICKUP_VALUE: readonly number[] = [
  0, // none
  100, // extra pop
  90, // flame
  70, // roller
  60, // kick
  40, // toss
  50, // pierce
  90, // shield
  80, // max flame
  0, // jinx: never walked to
];

// Scratch (the module is synchronous and never re-entered).
const reject = new Uint8Array(CELL_COUNT);
const verified = new Uint8Array(CELL_COUNT);
const trapBonus = new Uint16Array(CELL_COUNT);
const score = new Int32Array(CELL_COUNT);
const needsBomb = new Uint8Array(CELL_COUNT);
const oppCells = new Int16Array(MAX_SEATS);
const wrongCells = new Int16Array(CELL_COUNT);
const trapCandidates = new Int16Array(8);

function ticksPerTile(state: SimState, seat: number): number {
  const speed = playerSpeed(state, seat);
  return Math.floor((TILE + speed - 1) / speed);
}

function cellX(cell: number): number {
  return cell % GRID_W;
}
function cellY(cell: number): number {
  return (cell - (cell % GRID_W)) / GRID_W;
}

/**
 * Input for walking in `move` from an off-centre position (`dx`, `dy` = subunits to the tile
 * centre): a turn the corner assist cannot take yet first walks towards the centre, keeping the
 * turn as the secondary direction.
 */
function steer(move: Direction, dx: number, dy: number): number {
  if (move === Dir.NONE) return 0;
  const horizontal = move === Dir.LEFT || move === Dir.RIGHT;
  const off = horizontal ? dy : dx;
  if (Math.abs(off) <= CORNER_ASSIST) return encodeInput(move);
  const settle = horizontal ? (off > 0 ? Dir.DOWN : Dir.UP) : off > 0 ? Dir.RIGHT : Dir.LEFT;
  return encodeInput(settle, move);
}

/** Direction that brings an off-centre bot back to its tile centre (NONE within the slack). */
function settleDir(dx: number, dy: number): Direction {
  if (dx > SETTLE_SLACK) return Dir.RIGHT;
  if (dx < -SETTLE_SLACK) return Dir.LEFT;
  if (dy > SETTLE_SLACK) return Dir.DOWN;
  if (dy < -SETTLE_SLACK) return Dir.UP;
  return Dir.NONE;
}

/** Collects the cells of alive opponents (other side); returns how many. */
function findOpponents(state: SimState, seat: number): number {
  let n = 0;
  const side = sideOf(state, seat);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (s === seat || !isSeatActive(state, s) || !state.alive[s]) continue;
    if (sideOf(state, s) === side) continue;
    oppCells[n++] = playerCell(state, s);
  }
  return n;
}

/** Is there a clear blast line of ≤ `range` cells from `cell` to an opponent cell? */
function opponentInLine(state: SimState, cell: number, range: number, opponents: number): boolean {
  const bx = cellX(cell);
  const by = cellY(cell);
  for (let o = 0; o < opponents; o++) {
    const target = oppCells[o] as number;
    const tx = cellX(target);
    const ty = cellY(target);
    if (tx !== bx && ty !== by) continue;
    const span = Math.abs(tx - bx) + Math.abs(ty - by);
    if (span > range) continue;
    const sx = Math.sign(tx - bx);
    const sy = Math.sign(ty - by);
    let clear = true;
    for (let r = 1; r < span && clear; r++) {
      const c = (by + sy * r) * GRID_W + bx + sx * r;
      clear = state.tiles[c] === Tile.FLOOR;
    }
    if (clear) return true;
  }
  return false;
}

/** Number of blast arms from `cell` that would break a crate (0–4). */
function cratesInReach(state: SimState, cell: number, range: number, pierce: boolean): number {
  let hits = 0;
  for (let i = 0; i < 4; i++) {
    let c = cell;
    for (let r = 1; r <= range; r++) {
      c = NEIGHBOR[c * 4 + i] as number;
      if (c < 0) break;
      const tile = state.tiles[c] as number;
      if (tile === Tile.WALL || tile === Tile.PILLAR) break;
      if (tile === Tile.CRATE) {
        hits++;
        if (!pierce) break;
        continue;
      }
      if ((bombGrid[c] as number) >= 0) break;
    }
  }
  return hits;
}

function manhattan(a: number, b: number): number {
  return Math.abs(cellX(a) - cellX(b)) + Math.abs(cellY(a) - cellY(b));
}

/** Nearest cell reached by the last `search` that never burns (lowest index on ties), or -1. */
function nearestSafe(): number {
  let best = -1;
  let bestDist = 32767;
  const count = reachedCells();
  for (let i = 0; i < count; i++) {
    const c = reached[i] as number;
    if (dStart[c] !== SAFE) continue;
    const d = dist[c] as number;
    if (d < bestDist || (d === bestDist && c < best)) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Escape target: the nearest safe cell, or – for bots that plan around opponents – the safe cell
 * within two extra steps that keeps the most distance to the nearest opponent and is no dead end.
 */
function escapeTarget(state: SimState, seat: number, profile: BotProfile): number {
  const nearest = nearestSafe();
  if (nearest < 0 || profile.trap === 0) return nearest;
  const opponents = findOpponents(state, seat);
  if (opponents === 0) return nearest;
  const limit = (dist[nearest] as number) + 2;
  let best = nearest;
  let bestScore = -1_000_000;
  const count = reachedCells();
  for (let i = 0; i < count; i++) {
    const c = reached[i] as number;
    if (dStart[c] !== SAFE || (dist[c] as number) > limit) continue;
    let away = 99;
    for (let o = 0; o < opponents; o++) away = Math.min(away, manhattan(c, oppCells[o] as number));
    let exits = 0;
    for (let k = 0; k < 4; k++) {
      const n = NEIGHBOR[c * 4 + k] as number;
      if (n >= 0 && state.tiles[n] === Tile.FLOOR && dStart[n] === SAFE) exits++;
    }
    const sc = away * 8 - (dist[c] as number) * 10 - (exits < 2 ? 40 : 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return best;
}

/** Reached cell that burns last (the least bad place when nothing is safe). */
function latestBurn(): number {
  let best = -1;
  let bestStart = -1;
  const count = reachedCells();
  for (let i = 0; i < count; i++) {
    const c = reached[i] as number;
    const s = dStart[c] as number;
    if (s > bestStart || (s === bestStart && c < best)) {
      best = c;
      bestStart = s;
    }
  }
  return best;
}

/**
 * Would a bomb placed on `cell` by `seat` leave it an escape? Evaluated from `cell` itself with
 * the placed bomb (and the chain reactions it causes) in the danger map. Leaves the danger map
 * and search buffers describing that hypothetical.
 */
function canEscapeFrom(state: SimState, seat: number, cell: number, profile: BotProfile): boolean {
  const pierce = ((state.abilities[seat] as number) & Ability.PIERCE) !== 0;
  computeDanger(state, seat, 0, profile.chain, cell, state.range[seat] as number, pierce);
  search(state, seat, cell, ticksPerTile(state, seat), 12);
  const nearest = nearestSafe();
  if (nearest < 0) return false;
  // A short escape cannot be walled in in time; a long one needs a second way out.
  if (profile.trap === 0 || (dist[nearest] as number) < LONG_ESCAPE) return true;
  if (!opponentNear(state, seat, cell)) return true;
  // An opponent is close enough to wall the escape in with a bomb of its own: demand a second way.
  let dirs = 0;
  const count = reachedCells();
  for (let i = 1; i < count; i++) {
    const c = reached[i] as number;
    if (dStart[c] === SAFE) dirs |= 1 << ((firstDir[c] as number) - 1);
  }
  return (dirs & (dirs - 1)) !== 0;
}

/** Is an alive opponent within `NEAR_OPPONENT` tiles (Manhattan) of `cell`? */
function opponentNear(state: SimState, seat: number, cell: number): boolean {
  const side = sideOf(state, seat);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (s === seat || !isSeatActive(state, s) || !state.alive[s] || sideOf(state, s) === side) {
      continue;
    }
    if (manhattan(cell, playerCell(state, s)) <= NEAR_OPPONENT) return true;
  }
  return false;
}

/** Would a bomb on `cell` leave opponent standing on `target` without any escape? */
function trapsOpponent(
  state: SimState,
  seat: number,
  cell: number,
  target: number,
  profile: BotProfile,
): boolean {
  let opp = -1;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (s !== seat && isSeatActive(state, s) && state.alive[s] && playerCell(state, s) === target) {
      opp = s;
      break;
    }
  }
  if (opp < 0) return false;
  const pierce = ((state.abilities[seat] as number) & Ability.PIERCE) !== 0;
  computeDanger(state, opp, 0, profile.chain, cell, state.range[seat] as number, pierce);
  if (dStart[target] === SAFE) return false;
  search(state, opp, target, ticksPerTile(state, opp), 12);
  return nearestSafe() < 0;
}

function chooseDirection(state: SimState, seat: number): Direction {
  const r = randInt(state.rng, RngStream.AI0 + seat, 4);
  return (r + 1) as Direction;
}

/** Ghost seat: glide along the wall in a random direction, drop revenge bombs at random. */
function ghostInput(state: SimState, seat: number): number {
  const stream = RngStream.AI0 + seat;
  let timer = state.aiTimer[seat] as number;
  let dir = state.aiGoal[seat] as number;
  if (timer === 0 || dir === NO_GOAL) {
    dir = chooseDirection(state, seat);
    state.aiGoal[seat] = dir;
    timer = 60 + randInt(state.rng, stream, 60);
  }
  state.aiTimer[seat] = timer - 1;
  const other = chooseDirectionStable(dir, timer);
  const bomb = (state.ghostCd[seat] as number) === 0 && randInt(state.rng, stream, 4) === 0;
  return encodeInput(dir as Direction, other, bomb);
}

/** A secondary direction that flips between the two perpendicular ones (cheap, no RNG). */
function chooseDirectionStable(dir: number, timer: number): Direction {
  const horizontal = dir === Dir.LEFT || dir === Dir.RIGHT;
  const pick = (timer >> 4) & 1;
  return horizontal ? (pick ? Dir.UP : Dir.DOWN) : pick ? Dir.LEFT : Dir.RIGHT;
}

/** Input byte for bot `seat` this tick (0 outside the playing phase). */
export function botInput(state: SimState, seat: number): number {
  const hdr = state.hdr;
  if (hdr[Hdr.PHASE] !== Phase.PLAYING || !isSeatActive(state, seat)) return 0;
  if (!state.alive[seat]) {
    return state.ghost[seat] ? ghostInput(state, seat) : 0;
  }
  const profile = botProfile(botLevel(state, seat));
  const out = aliveInput(state, seat, profile);
  // A reversed-controls curse flips the input once more inside `step`: pre-flip it.
  return state.jinx[seat] === Jinx.REVERSED ? flip(out) : out;
}

function flip(input: number): number {
  const main = flipDir(input & 7);
  const second = flipDir((input >> 3) & 7);
  return (input & 0x40) | main | (second << 3);
}

function flipDir(dir: number): number {
  switch (dir) {
    case Dir.UP:
      return Dir.DOWN;
    case Dir.DOWN:
      return Dir.UP;
    case Dir.LEFT:
      return Dir.RIGHT;
    case Dir.RIGHT:
      return Dir.LEFT;
    default:
      return dir;
  }
}

function aliveInput(state: SimState, seat: number, profile: BotProfile): number {
  const stream = RngStream.AI0 + seat;
  const cell = playerCell(state, seat);
  const px = state.px[seat] as number;
  const py = state.py[seat] as number;
  const dx = tileCenter(toTile(px)) - px;
  const dy = tileCenter(toTile(py)) - py;
  const tpt = ticksPerTile(state, seat);

  computeDanger(state, seat, profile.reaction, profile.chain);
  let mode = state.aiMode[seat] as number;
  let goal = state.aiGoal[seat] as number;
  // Leave at once when the bot's own bomb threatens the cell; a bomb of somebody else that is
  // still far from going off is only a reason to leave once the time left is about what the way
  // out takes (otherwise goal walking and escaping would fight over the cell).
  let inDanger = false;
  if (dStart[cell] !== SAFE) {
    inDanger = mode === MODE_ESCAPE || dOwn[cell] !== SAFE;
    if (!inDanger) {
      search(state, seat, cell, tpt, 24);
      const way = nearestSafe();
      inDanger = way < 0 || (dStart[cell] as number) <= ((dist[way] as number) + 1) * tpt + SLACK;
    }
  }

  if (inDanger) {
    search(state, seat, cell, tpt, 24);
    // The escape target is kept while it stays reachable and safe; a mistaken one (aiTimer 1)
    // is followed until the bot gets there.
    const keep =
      mode === MODE_ESCAPE &&
      goal !== NO_GOAL &&
      goal !== cell &&
      (dist[goal] as number) >= 0 &&
      (dStart[goal] === SAFE || state.aiTimer[seat] === 1);
    if (!keep) {
      let target = escapeTarget(state, seat, profile);
      let mistaken = 0;
      if (target >= 0 && randInt(state.rng, stream, 1000) < profile.mistakePermille) {
        const wrong = wrongTarget(state, seat, target);
        mistaken = wrong !== target ? 1 : 0;
        target = wrong;
      }
      if (target < 0) {
        // Boxed in: a Toss bot on its own bomb throws it away, otherwise run to the longest fuse.
        if (profile.toss && tossable(state, seat)) return encodeInput(Dir.NONE, Dir.NONE, true);
        target = latestBurn();
      }
      goal = target < 0 ? cell : target;
      mode = MODE_ESCAPE;
      state.aiGoal[seat] = goal;
      state.aiMode[seat] = mode;
      state.aiTimer[seat] = mistaken;
    }
    if (goal === cell || (dist[goal] as number) < 0) return steer(settleDir(dx, dy), dx, dy);
    return steer(firstDir[goal] as Direction, dx, dy);
  }

  if (mode === MODE_ESCAPE) {
    mode = MODE_GOAL;
    state.aiMode[seat] = mode;
    state.aiTimer[seat] = 0;
  }
  let timer = state.aiTimer[seat] as number;
  if (mode === MODE_BOMB && goal === cell) timer = 0;
  if (goal !== NO_GOAL && dStart[goal] !== SAFE) timer = 0;
  if (timer > 0) {
    state.aiTimer[seat] = timer - 1;
    return goal === NO_GOAL ? 0 : walkTo(state, seat, cell, goal, tpt, dx, dy);
  }
  return decide(state, seat, profile, cell, dx, dy, tpt);
}

/** Toss is possible: standing on an own bomb with the ability and a landing tile in front. */
function tossable(state: SimState, seat: number): boolean {
  if (((state.abilities[seat] as number) & Ability.TOSS) === 0) return false;
  const dir = state.facing[seat] as number;
  const x = toTile(state.px[seat] as number);
  const y = toTile(state.py[seat] as number);
  for (let d = 3; d >= 1; d--) {
    if (bombCanEnter(state, x + (DIR_DX[dir] as number) * d, y + (DIR_DY[dir] as number) * d)) {
      return (bombGrid[y * GRID_W + x] as number) >= 0;
    }
  }
  return false;
}

/** A wrong escape: a random reached cell within 3 steps that is not the right one. */
function wrongTarget(state: SimState, seat: number, right: number): number {
  const count = reachedCells();
  let n = 0;
  for (let i = 1; i < count; i++) {
    const c = reached[i] as number;
    if (c !== right && (dist[c] as number) <= 3) wrongCells[n++] = c;
  }
  if (n === 0) return right;
  return wrongCells[randInt(state.rng, RngStream.AI0 + seat, n)] as number;
}

/** Steps towards `goal` along the search path; settles on the cell centre once there. */
function walkTo(
  state: SimState,
  seat: number,
  cell: number,
  goal: number,
  tpt: number,
  dx: number,
  dy: number,
): number {
  if (goal === cell) return steer(settleDir(dx, dy), dx, dy);
  search(state, seat, cell, tpt, 40, true);
  if ((dist[goal] as number) < 0) return steer(settleDir(dx, dy), dx, dy);
  return steer(firstDir[goal] as Direction, dx, dy);
}

/** Picks a new goal (and maybe places a bomb). */
function decide(
  state: SimState,
  seat: number,
  profile: BotProfile,
  cell: number,
  dx: number,
  dy: number,
  tpt: number,
): number {
  const stream = RngStream.AI0 + seat;
  state.aiTimer[seat] = profile.interval;
  state.aiMode[seat] = MODE_GOAL;

  const range = state.range[seat] as number;
  const pierce = ((state.abilities[seat] as number) & Ability.PIERCE) !== 0;
  const canBomb =
    bombsInUse(state, seat) < (state.bombCap[seat] as number) && state.jinx[seat] !== Jinx.NO_BOMB;
  const opponents = findOpponents(state, seat);
  const centred = Math.abs(dx) <= DROP_WINDOW && Math.abs(dy) <= DROP_WINDOW;

  // Kick an adjacent bomb towards an opponent.
  if (profile.kick && ((state.abilities[seat] as number) & Ability.KICK) !== 0 && centred) {
    const dir = kickDirection(state, cell, opponents);
    if (dir !== Dir.NONE && randInt(state.rng, stream, 100) < profile.aggression) {
      state.aiTimer[seat] = 2;
      return encodeInput(dir);
    }
  }

  search(state, seat, cell, tpt, GOAL_STEPS, true);
  const count = reachedCells();
  const sd = suddenDeathActive(state);
  const chase = Math.floor(profile.aggression / 5);

  // Trap candidates: attack cells (Hard) or any cell near an opponent (Expert) that really trap.
  trapBonus.fill(0);
  verified.fill(0);
  reject.fill(0);
  if (canBomb && profile.trap > 0 && opponents > 0) {
    planTraps(state, seat, profile, count, range, opponents);
  }

  // The planning above clobbered the danger map: restore this bot's view and its search.
  computeDanger(state, seat, profile.reaction, profile.chain);
  search(state, seat, cell, tpt, GOAL_STEPS, true);

  for (let i = 0; i < count; i++) {
    const c = reached[i] as number;
    if (dStart[c] !== SAFE) {
      score[c] = -1_000_000;
      needsBomb[c] = 0;
      continue;
    }
    const d = dist[c] as number;
    let value = PICKUP_VALUE[state.pickup[c] as number] as number;
    let bomb = 0;
    if (canBomb && (bombGrid[c] as number) < 0) {
      const crates = cratesInReach(state, c, range, pierce);
      let attack = 0;
      if (opponents > 0 && opponentInLine(state, c, range, opponents)) {
        attack = Math.floor((profile.aggression * 6) / 10) + (trapBonus[c] as number);
      } else if ((trapBonus[c] as number) > 0) {
        attack = trapBonus[c] as number;
      }
      if (crates > 0 || attack > 0) bomb = 1;
      value += crates * 25 + attack;
    }
    needsBomb[c] = bomb;
    let s = value * 10 - d * STEP_COST;
    if (opponents > 0) {
      let nearest = 99;
      for (let o = 0; o < opponents; o++) nearest = Math.min(nearest, manhattan(c, oppCells[o]!));
      s += (30 - nearest) * chase;
    }
    if (sd) s += (14 - manhattan(c, 6 * GRID_W + 6)) * 40;
    s += randInt(state.rng, stream, JITTER);
    score[c] = s;
  }

  // Pick the best candidate; bomb spots must pass the safe-placement check.
  for (let attempt = 0; attempt < 6; attempt++) {
    let best = -1;
    let bestScore = -2_000_000;
    for (let i = 0; i < count; i++) {
      const c = reached[i] as number;
      if (reject[c] !== 0) continue;
      const sc = (score[c] as number) + (c === cell ? 1 : 0);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    if (best < 0) break;
    if (needsBomb[best] !== 0 && verified[best] === 0) {
      const ok = canEscapeFrom(state, seat, best, profile);
      computeDanger(state, seat, profile.reaction, profile.chain);
      if (!ok) {
        reject[best] = 1;
        // Re-run the search for the walking directions below.
        search(state, seat, cell, tpt, GOAL_STEPS, true);
        continue;
      }
      verified[best] = 1;
      search(state, seat, cell, tpt, GOAL_STEPS, true);
    }
    if (best === cell) {
      if (needsBomb[best] !== 0) {
        if (centred) {
          state.aiTimer[seat] = 0;
          return encodeInput(Dir.NONE, Dir.NONE, true);
        }
        state.aiTimer[seat] = 0;
        state.aiGoal[seat] = cell;
        state.aiMode[seat] = MODE_BOMB;
        return steer(settleDir(dx, dy), dx, dy);
      }
      state.aiGoal[seat] = cell;
      return steer(settleDir(dx, dy), dx, dy);
    }
    state.aiGoal[seat] = best;
    state.aiMode[seat] = needsBomb[best] !== 0 ? MODE_BOMB : MODE_GOAL;
    return steer(firstDir[best] as Direction, dx, dy);
  }
  state.aiGoal[seat] = cell;
  return steer(settleDir(dx, dy), dx, dy);
}

/**
 * Looks for bomb spots that leave an opponent without escape. At most `TRAP_CHECKS` of the nearest
 * candidates (attack cells for Hard, any cell near an opponent for Expert) are evaluated; each one
 * that works – and that the bot itself survives – gets a bonus. Clobbers the danger map and the
 * search buffers (the caller recomputes them).
 */
const TRAP_CHECKS = 3;
const TRAP_BONUS = 400;
function planTraps(
  state: SimState,
  seat: number,
  profile: BotProfile,
  count: number,
  range: number,
  opponents: number,
): void {
  let found = 0;
  // `reached` is in BFS order, i.e. nearest first. Gather first: the checks below reuse it.
  for (let i = 0; i < count && found < TRAP_CHECKS; i++) {
    const c = reached[i] as number;
    if (dStart[c] !== SAFE || (bombGrid[c] as number) >= 0) continue;
    let target = -1;
    for (let o = 0; o < opponents && target < 0; o++) {
      const t = oppCells[o] as number;
      const near = manhattan(c, t);
      const line = cellX(c) === cellX(t) || cellY(c) === cellY(t);
      if ((line && near <= range) || (profile.trap >= 2 && near <= range + 2)) target = t;
    }
    if (target < 0) continue;
    trapCandidates[found * 2] = c;
    trapCandidates[found * 2 + 1] = target;
    found++;
  }
  for (let k = 0; k < found; k++) {
    const c = trapCandidates[k * 2] as number;
    const target = trapCandidates[k * 2 + 1] as number;
    if (!trapsOpponent(state, seat, c, target, profile)) continue;
    if (!canEscapeFrom(state, seat, c, profile)) continue;
    trapBonus[c] = TRAP_BONUS;
    verified[c] = 1;
  }
}

/** Direction in which kicking an adjacent resting bomb sends it at an opponent, or NONE. */
function kickDirection(state: SimState, cell: number, opponents: number): Direction {
  for (let i = 0; i < 4; i++) {
    const next = NEIGHBOR[cell * 4 + i] as number;
    if (next < 0) continue;
    const g = bombGrid[next] as number;
    if (g < 0 || state.bombSlide[g] !== 0) continue;
    // The lane behind the bomb.
    let c = next;
    for (let r = 0; r < 7; r++) {
      c = NEIGHBOR[c * 4 + i] as number;
      if (c < 0 || state.tiles[c] !== Tile.FLOOR || (bombGrid[c] as number) >= 0) break;
      for (let o = 0; o < opponents; o++) if (oppCells[o] === c) return (i + 1) as Direction;
    }
  }
  return Dir.NONE;
}

function suddenDeathActive(state: SimState): boolean {
  const hdr = state.hdr;
  return (
    ((hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.SUDDEN_DEATH) !== 0 &&
    (hdr[Hdr.ROUND_TICKS] as number) > 0 &&
    (hdr[Hdr.ROUND_TIME] as number) === 0
  );
}
