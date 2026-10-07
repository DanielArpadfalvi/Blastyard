/**
 * Arenas: ASCII format, parser, validator and seeded generation (crates + hidden power-ups).
 *
 * Format (13 rows × 13 chars, JSON-compatible data in `src/content/arenas`):
 *   `#` wall · `o` pillar · `.` floor (never a crate) · `+` fixed crate · `?` crate candidate ·
 *   `1`–`4` spawn (floor). Floor mechanics (T4.3) are floor cells with a `floor` effect:
 *   `~` ice · `^ > v <` conveyor belt · `T` / `U` teleport pair (exactly two of each) · `=` tunnel
 *   mouth (on the outer ring, paired with the opposite mouth) · `b` trampoline · `g` growing
 *   pillar.
 * Generation: exactly `crateDensity`% of the candidates (rounded) become crates – picked by a
 * seeded partial shuffle – then every crate hides a power-up with `powerupChance`% probability,
 * kind drawn by integer weights. Crates use the ARENA stream, power-ups the LOOT stream.
 */

import { RngStream, randInt, randPercent, randWeighted } from './rng';
import {
  CELL_COUNT,
  FloorFx,
  GRID_H,
  GRID_W,
  Mech,
  NO_OWNER,
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

/** Floor mechanics an arena can declare (`ArenaDef.mechanics`, checked against the layout). */
export const MECHANIC_IDS = ['ice', 'belt', 'teleport', 'tunnel', 'trampoline', 'grow'] as const;
export type MechanicId = (typeof MECHANIC_IDS)[number];

export interface ArenaDef {
  readonly id: string;
  readonly theme: string;
  readonly size: number;
  readonly rows: readonly string[];
  /** Percent of `?` candidates that become crates (integer 0–100, default 70). */
  readonly crateDensity?: number;
  /** Per-arena power-up weights (length 9), overriding the rule set. */
  readonly powerupWeights?: readonly number[];
  /** Floor mechanics the layout uses (must match the layout exactly; informs UI and docs). */
  readonly mechanics?: readonly MechanicId[];
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
  /** `FloorFx` per cell. */
  readonly fx: Uint8Array;
  /** Partner pad per teleport / tunnel cell (0 = none). */
  readonly partner: Uint8Array;
  /** `Mech` bits the layout uses. */
  readonly mech: number;
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
  | 'fairness'
  | 'mechanic';

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

/** Floor-effect characters (the cell itself is plain floor). */
const CHAR_TO_FX: Readonly<Record<string, number>> = {
  '~': FloorFx.ICE,
  '^': FloorFx.BELT_UP,
  '>': FloorFx.BELT_RIGHT,
  v: FloorFx.BELT_DOWN,
  '<': FloorFx.BELT_LEFT,
  T: FloorFx.TELEPORT,
  U: FloorFx.TELEPORT,
  '=': FloorFx.TUNNEL,
  b: FloorFx.TRAMPOLINE,
  g: FloorFx.GROW,
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
  const fx = new Uint8Array(CELL_COUNT);
  const partner = new Uint8Array(CELL_COUNT);
  const pads: Record<string, number[]> = { T: [], U: [] };
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
      const effect = CHAR_TO_FX[ch];
      if (effect !== undefined) {
        cells[i] = LayoutCell.FLOOR;
        fx[i] = effect;
        pads[ch]?.push(i);
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
  for (const ch of ['T', 'U']) {
    const list = pads[ch] as number[];
    if (list.length === 0) continue;
    if (list.length !== 2) {
      errors.push({ code: 'mechanic', message: `teleport '${ch}' needs exactly two pads` });
      continue;
    }
    partner[list[0] as number] = list[1] as number;
    partner[list[1] as number] = list[0] as number;
  }
  let mech = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const effect = fx[i] as number;
    if (effect === FloorFx.TUNNEL) {
      mech |= Mech.TELEPORT;
      const x = i % GRID_W;
      const y = (i - x) / GRID_W;
      const onX = x === 0 || x === GRID_W - 1;
      const onY = y === 0 || y === GRID_H - 1;
      if (onX === onY) {
        errors.push({ code: 'mechanic', message: `tunnel at (${x}, ${y}) must be on a side` });
        continue;
      }
      const other = cellIndex(onX ? GRID_W - 1 - x : x, onY ? GRID_H - 1 - y : y);
      if (fx[other] !== FloorFx.TUNNEL) {
        errors.push({ code: 'mechanic', message: `tunnel at (${x}, ${y}) has no opposite mouth` });
        continue;
      }
      partner[i] = other;
    } else if (effect === FloorFx.TELEPORT) mech |= Mech.TELEPORT;
    else if (effect === FloorFx.ICE) mech |= Mech.ICE;
    else if (effect >= FloorFx.BELT_UP && effect <= FloorFx.BELT_LEFT) mech |= Mech.BELT;
    else if (effect === FloorFx.TRAMPOLINE) mech |= Mech.TRAMPOLINE;
    else if (effect === FloorFx.GROW) mech |= Mech.GROW;
  }
  return { parsed: { cells, spawns, fx, partner, mech }, errors };
}

/** Mechanic ids present in a parsed layout (for the `mechanics` declaration check). */
function mechanicIds(parsed: ParsedArena): MechanicId[] {
  const out: MechanicId[] = [];
  let tunnel = false;
  let teleport = false;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (parsed.fx[i] === FloorFx.TUNNEL) tunnel = true;
    else if (parsed.fx[i] === FloorFx.TELEPORT) teleport = true;
  }
  if ((parsed.mech & Mech.ICE) !== 0) out.push('ice');
  if ((parsed.mech & Mech.BELT) !== 0) out.push('belt');
  if (teleport) out.push('teleport');
  if (tunnel) out.push('tunnel');
  if ((parsed.mech & Mech.TRAMPOLINE) !== 0) out.push('trampoline');
  if ((parsed.mech & Mech.GROW) !== 0) out.push('grow');
  return out;
}

/** The three cells (spawn, horizontal arm, vertical arm) of the first open safe L, or null. */
export function spawnSafeL(parsed: ParsedArena, spawn: number): readonly number[] | null {
  const sx = spawn % GRID_W;
  const sy = (spawn - sx) / GRID_W;
  for (const [dx, dy] of L_ORIENTATIONS) {
    if (!inBounds(sx + dx, sy) || !inBounds(sx, sy + dy)) continue;
    const arm1 = cellIndex(sx + dx, sy);
    const arm2 = cellIndex(sx, sy + dy);
    if (
      parsed.cells[arm1] === LayoutCell.FLOOR &&
      parsed.cells[arm2] === LayoutCell.FLOOR &&
      parsed.fx[arm1] === FloorFx.NONE &&
      parsed.fx[arm2] === FloorFx.NONE
    ) {
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
 * cells (and floor effects) lie at that distance. Spawns of a fair arena have identical signatures.
 */
function fxClass(effect: number): number {
  if (effect === FloorFx.NONE) return 0;
  if (effect === FloorFx.ICE) return 1;
  if (effect <= FloorFx.BELT_LEFT) return 2;
  if (effect === FloorFx.TELEPORT || effect === FloorFx.TUNNEL) return 3;
  return effect === FloorFx.TRAMPOLINE ? 4 : 5;
}

function spawnSignature(cells: Uint8Array, fx: Uint8Array, spawn: number): string {
  const dist = bfs(cells, spawn);
  const counts: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const d = dist[i] as number;
    if (d < 0) continue;
    const cell = cells[i] as number;
    const slot =
      (d * 3 + (cell === LayoutCell.FLOOR ? 0 : cell === LayoutCell.FIXED_CRATE ? 1 : 2)) * 6 +
      fxClass(fx[i] as number);
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return Array.from(counts, (c) => c ?? 0).join(',');
}

function validWeights(weights: ArrayLike<number>): boolean {
  if (weights.length !== PICKUP_KIND_COUNT) return false;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] as number;
    if (!Number.isInteger(w) || w < 0) return false;
    sum += w;
  }
  return sum > 0;
}

/**
 * Checks shape, characters, border, spawns 1–4, a 3-cell safe L per spawn (spawn + one horizontal
 * and one vertical neighbour, all plain floor), one connected non-solid region, and spawn fairness
 * (identical BFS distance signatures).
 */
export function validateArena(def: ArenaDef): ArenaValidation {
  const { parsed, errors } = parseArena(def);
  if (!parsed) return { ok: false, errors, parsed: null };
  const { cells, spawns, fx } = parsed;

  for (let i = 0; i < CELL_COUNT; i++) {
    const x = i % GRID_W;
    const y = (i - x) / GRID_W;
    const edge = x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
    if (edge && cells[i] !== LayoutCell.WALL && parsed.fx[i] !== FloorFx.TUNNEL) {
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

  const declared = def.mechanics;
  if (declared) {
    const found = mechanicIds(parsed);
    if (declared.length !== found.length || found.some((id) => !declared.includes(id))) {
      errors.push({
        code: 'mechanic',
        message: `mechanics [${declared.join(', ')}] do not match the layout [${found.join(', ')}]`,
      });
    }
  }
  for (let i = 0; i < CELL_COUNT; i++) {
    if (fx[i] !== FloorFx.TUNNEL) continue;
    const x = i % GRID_W;
    const y = (i - x) / GRID_W;
    const inner = cellIndex(
      x === 0 ? 1 : x === GRID_W - 1 ? GRID_W - 2 : x,
      y === 0 ? 1 : y === GRID_H - 1 ? GRID_H - 2 : y,
    );
    if (isSolid(cells[inner] as number)) {
      errors.push({ code: 'mechanic', message: `tunnel at (${x}, ${y}) is walled in` });
    }
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
  if ((parsed.mech & Mech.GROW) !== 0) {
    // Once every growing pillar has risen, the rest of the arena must still hang together.
    const grown = cells.slice();
    for (let i = 0; i < CELL_COUNT; i++) {
      if (fx[i] === FloorFx.GROW) grown[i] = LayoutCell.PILLAR;
    }
    const after = bfs(grown, spawns[0] as number);
    for (let i = 0; i < CELL_COUNT; i++) {
      if (!isSolid(grown[i] as number) && after[i] === -1) {
        errors.push({ code: 'connectivity', message: 'growing pillars cut the arena in two' });
        break;
      }
    }
  }

  // The majority signature is the reference (ties: the lowest spawn), so the odd one is named.
  const signatures = spawns.map((s) => spawnSignature(cells, fx, s));
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
  readonly powerupWeights: ArrayLike<number>;
}

/**
 * Writes the static layout into `state.tiles`, then fills crates and hidden power-ups from the
 * state's ARENA / LOOT streams. Clears open pickups, grace timers and flames.
 */
export function fillArena(
  state: SimState,
  parsed: Pick<ParsedArena, 'cells'>,
  opts: ArenaFillOptions,
): void {
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
  state.flameOwner.fill(NO_OWNER);

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
