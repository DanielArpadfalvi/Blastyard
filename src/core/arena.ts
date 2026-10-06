/**
 * Arenas: ASCII format, parser, validator and seeded generation (crates + hidden power-ups).
 *
 * Format (13 rows × 13 chars, JSON-compatible data in `src/content/arenas`):
 *   `#` wall · `o` pillar · `.` floor (never a crate) · `+` fixed crate · `?` crate candidate ·
 *   `1`–`4` spawn (floor).
 * Generation: exactly `crateDensity`% of the candidates (rounded) become crates – picked by a
 * seeded partial shuffle – then every crate hides a power-up with `powerupChance`% probability,
 * kind drawn by integer weights. Crates use the ARENA stream, power-ups the LOOT stream.
 */

import { RngStream, randInt, randPercent, randWeighted } from './rng';
import {
  CELL_COUNT,
  GRID_H,
  GRID_W,
  PICKUP_KIND_COUNT,
  Tile,
  cellIndex,
  inBounds,
  type SimState,
} from './state';

export const ARENA_SIZE = 13;
export const DEFAULT_CRATE_DENSITY = 70;
export const DEFAULT_POWERUP_CHANCE = 30;
export const SPAWN_COUNT = 4;

/**
 * Default power-up weights (PLAN §1.2), indexed by `Pickup` kind − 1:
 * Extra Pop, Flame, Roller, Kick, Toss, Pierce, Shield, Max Flame, Jinx.
 */
export const DEFAULT_POWERUP_WEIGHTS: readonly number[] = [26, 26, 16, 8, 6, 5, 5, 3, 5];

export interface ArenaDef {
  readonly id: string;
  readonly theme: string;
  readonly size: number;
  readonly rows: readonly string[];
  /** Percent of `?` candidates that become crates (integer 0–100, default 70). */
  readonly crateDensity?: number;
  /** Per-arena power-up weights (length 9), overriding the rule set. */
  readonly powerupWeights?: readonly number[];
}

/** Static cell classes of a parsed layout. */
export const LayoutCell = {
  FLOOR: 0,
  WALL: 1,
  PILLAR: 2,
  FIXED_CRATE: 3,
  CANDIDATE: 4,
} as const;
export type LayoutCellType = (typeof LayoutCell)[keyof typeof LayoutCell];

export interface ParsedArena {
  /** `LayoutCell` per cell, index = y * 13 + x. */
  readonly cells: Uint8Array;
  /** Cell index of spawn 1–4 (array index = spawn number − 1); −1 when missing. */
  readonly spawns: readonly number[];
}

export type ArenaErrorCode =
  | 'size'
  | 'char'
  | 'border'
  | 'spawn'
  | 'density'
  | 'weights'
  | 'safe-l'
  | 'connectivity'
  | 'fairness';

export interface ArenaError {
  readonly code: ArenaErrorCode;
  readonly message: string;
}

export interface ArenaValidation {
  readonly ok: boolean;
  readonly errors: readonly ArenaError[];
  readonly parsed: ParsedArena | null;
}

const CHAR_TO_CELL: Readonly<Record<string, LayoutCellType>> = {
  '#': LayoutCell.WALL,
  o: LayoutCell.PILLAR,
  '.': LayoutCell.FLOOR,
  '+': LayoutCell.FIXED_CRATE,
  '?': LayoutCell.CANDIDATE,
};

/** L orientations tried for the spawn safe zone, in this order: (dx, dy). */
const L_ORIENTATIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** 4-neighbourhood: up, right, down, left. */
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function isSolid(cell: number): boolean {
  return cell === LayoutCell.WALL || cell === LayoutCell.PILLAR;
}

/**
 * Parses the ASCII rows. Returns errors for shape/character problems; `parsed` is null only when
 * the grid shape itself is wrong.
 */
export function parseArena(def: ArenaDef): { parsed: ParsedArena | null; errors: ArenaError[] } {
  const errors: ArenaError[] = [];
  if (
    def.size !== ARENA_SIZE ||
    def.rows.length !== GRID_H ||
    def.rows.some((row) => row.length !== GRID_W)
  ) {
    errors.push({ code: 'size', message: `arena must be ${GRID_W}×${GRID_H}` });
    return { parsed: null, errors };
  }
  const cells = new Uint8Array(CELL_COUNT);
  const spawns = [-1, -1, -1, -1];
  for (let y = 0; y < GRID_H; y++) {
    const row = def.rows[y] as string;
    for (let x = 0; x < GRID_W; x++) {
      const ch = row[x] as string;
      const i = cellIndex(x, y);
      if (ch >= '1' && ch <= '4') {
        const n = ch.charCodeAt(0) - 49;
        if (spawns[n] !== -1) {
          errors.push({ code: 'spawn', message: `spawn ${ch} appears more than once` });
        }
        spawns[n] = i;
        cells[i] = LayoutCell.FLOOR;
        continue;
      }
      const cell = CHAR_TO_CELL[ch];
      if (cell === undefined) {
        errors.push({ code: 'char', message: `unknown tile '${ch}' at (${x}, ${y})` });
        cells[i] = LayoutCell.WALL;
      } else {
        cells[i] = cell;
      }
    }
  }
  return { parsed: { cells, spawns }, errors };
}

/** The three cells (spawn, horizontal arm, vertical arm) of the first open safe L, or null. */
export function spawnSafeL(parsed: ParsedArena, spawn: number): readonly number[] | null {
  const sx = spawn % GRID_W;
  const sy = (spawn - sx) / GRID_W;
  for (const [dx, dy] of L_ORIENTATIONS) {
    if (!inBounds(sx + dx, sy) || !inBounds(sx, sy + dy)) continue;
    const arm1 = cellIndex(sx + dx, sy);
    const arm2 = cellIndex(sx, sy + dy);
    if (parsed.cells[arm1] === LayoutCell.FLOOR && parsed.cells[arm2] === LayoutCell.FLOOR) {
      return [spawn, arm1, arm2];
    }
  }
  return null;
}

/** BFS distances over non-solid cells from `start` (−1 = unreachable). */
function bfs(cells: Uint8Array, start: number): Int16Array {
  const dist = new Int16Array(CELL_COUNT).fill(-1);
  const queue = new Int16Array(CELL_COUNT);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const c = queue[head++] as number;
    const x = c % GRID_W;
    const y = (c - x) / GRID_W;
    const d = (dist[c] as number) + 1;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const n = cellIndex(nx, ny);
      if (dist[n] !== -1 || isSolid(cells[n] as number)) continue;
      dist[n] = d;
      queue[tail++] = n;
    }
  }
  return dist;
}

/**
 * Fairness signature of a spawn: for each BFS distance, how many floor / fixed-crate / candidate
 * cells lie at that distance. Spawns of a fair arena have identical signatures.
 */
function spawnSignature(cells: Uint8Array, spawn: number): string {
  const dist = bfs(cells, spawn);
  const counts: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const d = dist[i] as number;
    if (d < 0) continue;
    const cell = cells[i] as number;
    const slot = d * 3 + (cell === LayoutCell.FLOOR ? 0 : cell === LayoutCell.FIXED_CRATE ? 1 : 2);
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return Array.from(counts, (c) => c ?? 0).join(',');
}

function validWeights(weights: readonly number[]): boolean {
  return (
    weights.length === PICKUP_KIND_COUNT &&
    weights.every((w) => Number.isInteger(w) && w >= 0) &&
    weights.some((w) => w > 0)
  );
}

/**
 * Checks shape, characters, border, spawns 1–4, a 3-cell safe L per spawn (spawn + one horizontal
 * and one vertical neighbour, all plain floor), one connected non-solid region, and spawn fairness
 * (identical BFS distance signatures).
 */
export function validateArena(def: ArenaDef): ArenaValidation {
  const { parsed, errors } = parseArena(def);
  if (!parsed) return { ok: false, errors, parsed: null };
  const { cells, spawns } = parsed;

  for (let i = 0; i < CELL_COUNT; i++) {
    const x = i % GRID_W;
    const y = (i - x) / GRID_W;
    const edge = x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
    if (edge && cells[i] !== LayoutCell.WALL) {
      errors.push({ code: 'border', message: `outer ring must be wall at (${x}, ${y})` });
      break;
    }
  }

  const density = def.crateDensity ?? DEFAULT_CRATE_DENSITY;
  if (!Number.isInteger(density) || density < 0 || density > 100) {
    errors.push({ code: 'density', message: 'crateDensity must be an integer 0–100' });
  }
  if (def.powerupWeights && !validWeights(def.powerupWeights)) {
    errors.push({ code: 'weights', message: 'powerupWeights: 9 non-negative integers, sum > 0' });
  }

  const missing = spawns.findIndex((s) => s < 0);
  if (missing >= 0) {
    errors.push({ code: 'spawn', message: `spawn ${missing + 1} is missing` });
    return { ok: false, errors, parsed };
  }

  spawns.forEach((s, n) => {
    if (!spawnSafeL(parsed, s)) {
      errors.push({ code: 'safe-l', message: `spawn ${n + 1} has no open 3-cell safe L` });
    }
  });

  const dist = bfs(cells, spawns[0] as number);
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!isSolid(cells[i] as number) && dist[i] === -1) {
      const x = i % GRID_W;
      errors.push({
        code: 'connectivity',
        message: `cell (${x}, ${(i - x) / GRID_W}) is not reachable from spawn 1`,
      });
      break;
    }
  }

  // The majority signature is the reference (ties: the lowest spawn), so the odd one is named.
  const signatures = spawns.map((s) => spawnSignature(cells, s));
  const votes = signatures.map((sig) => signatures.filter((other) => other === sig).length);
  const reference = signatures[votes.indexOf(Math.max(...votes))];
  signatures.forEach((sig, n) => {
    if (sig !== reference) {
      errors.push({ code: 'fairness', message: `spawn ${n + 1} sees a different arena` });
    }
  });

  return { ok: errors.length === 0, errors, parsed };
}

/** Validates and returns the parsed arena, throwing on any error. */
export function loadArena(def: ArenaDef): ParsedArena {
  const result = validateArena(def);
  if (!result.ok || !result.parsed) {
    throw new Error(
      `arena '${def.id}' is invalid: ${result.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return result.parsed;
}

export interface ArenaFillOptions {
  readonly crateDensity: number;
  readonly powerupChance: number;
  readonly powerupWeights: readonly number[];
}

/**
 * Writes the static layout into `state.tiles`, then fills crates and hidden power-ups from the
 * state's ARENA / LOOT streams. Clears open pickups and flames.
 */
export function fillArena(state: SimState, parsed: ParsedArena, opts: ArenaFillOptions): void {
  if (!validWeights(opts.powerupWeights)) throw new RangeError('fillArena: invalid weights');
  const { cells } = parsed;
  const candidates: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = cells[i] as number;
    state.tiles[i] =
      cell === LayoutCell.WALL
        ? Tile.WALL
        : cell === LayoutCell.PILLAR
          ? Tile.PILLAR
          : cell === LayoutCell.FIXED_CRATE
            ? Tile.CRATE
            : Tile.FLOOR;
    if (cell === LayoutCell.CANDIDATE) candidates.push(i);
  }
  state.hidden.fill(0);
  state.pickup.fill(0);
  state.pickupGrace.fill(0);
  state.flame.fill(0);

  // Exactly round(density% × candidates) crates via a seeded partial Fisher–Yates shuffle.
  const crateCount = Math.floor((candidates.length * opts.crateDensity + 50) / 100);
  for (let k = 0; k < crateCount; k++) {
    const j = k + randInt(state.rng, RngStream.ARENA, candidates.length - k);
    const picked = candidates[j] as number;
    candidates[j] = candidates[k] as number;
    candidates[k] = picked;
    state.tiles[picked] = Tile.CRATE;
  }

  for (let i = 0; i < CELL_COUNT; i++) {
    if (state.tiles[i] !== Tile.CRATE) continue;
    if (randPercent(state.rng, RngStream.LOOT, opts.powerupChance)) {
      state.hidden[i] = randWeighted(state.rng, RngStream.LOOT, opts.powerupWeights) + 1;
    }
  }
}
