/**
 * Simulation state: struct-of-arrays in typed arrays over ONE `ArrayBuffer`.
 *
 * Everything that influences `step` lives in this buffer (header, RNG streams, players, bombs,
 * grid layers), so `snapshot()` is a single byte copy, `restore()` a single `set`, and the state
 * hash is FNV-1a over the bytes. All values are integers: positions in subunits (1 tile = 256),
 * timers in ticks. The layout is fixed (no per-arena sizes) and part of `SIM_VERSION`.
 *
 * Byte order: multi-byte fields use the platform byte order (little-endian on every supported
 * target), so hashes and snapshots are comparable across devices.
 */

import { fnv1aBytes, FNV_OFFSET } from './hash';
import { RNG_STREAM_COUNT, RNG_WORDS } from './rng';
import { SIM_VERSION } from './version';

export const GRID_W = 13;
export const GRID_H = 13;
export const CELL_COUNT = GRID_W * GRID_H;
/** Subunits per tile (Q8). */
export const TILE = 256;
export const HALF_TILE = 128;
export const TILE_SHIFT = 8;

export const MAX_SEATS = 4;
/** 4 seats × max 6 bombs + ghost bombs + headroom. */
export const MAX_BOMBS = 32;
/** Owner value for bombs / flames without an owning seat. */
export const NO_OWNER = 255;
/** Killer value of a `DEATH` event caused by a challenge monster. */
export const MONSTER_KILLER = 254;

/** Grid tile types (`tiles` layer). Anything but FLOOR blocks movement. */
export const Tile = {
  FLOOR: 0,
  /** Outer wall (and later sudden-death blocks). */
  WALL: 1,
  /** Indestructible interior pillar. */
  PILLAR: 2,
  /** Destructible crate. */
  CRATE: 3,
} as const;
export type TileType = (typeof Tile)[keyof typeof Tile];

/** Power-up kinds (`hidden` / `pickup` layers). 0 = none. */
export const Pickup = {
  NONE: 0,
  EXTRA_POP: 1,
  FLAME: 2,
  ROLLER: 3,
  KICK: 4,
  TOSS: 5,
  PIERCE: 6,
  SHIELD: 7,
  MAX_FLAME: 8,
  JINX: 9,
} as const;
export type PickupKind = (typeof Pickup)[keyof typeof Pickup];
export const PICKUP_KIND_COUNT = 9;

/**
 * Per-cell floor mechanic (`floor` layer, static for a whole match; SIM_VERSION 4). The belt kinds
 * 2–5 are `Dir + 1` (up, right, down, left): see `beltDir`.
 */
export const FloorFx = {
  NONE: 0,
  /** Slippery: a player who lets go keeps gliding up to `ICE_SLIDE` subunits. */
  ICE: 1,
  BELT_UP: 2,
  BELT_RIGHT: 3,
  BELT_DOWN: 4,
  BELT_LEFT: 5,
  /** Paired pad (`partner` layer holds the other pad). */
  TELEPORT: 6,
  /** Border mouth, paired with the opposite border mouth. */
  TUNNEL: 7,
  /** A bomb placed on it, or sliding onto it, hops `TRAMPOLINE_HOP` tiles. */
  TRAMPOLINE: 8,
  /** Grows into a pillar once the round passes 75% of its time. */
  GROW: 9,
} as const;
export type FloorFxKind = (typeof FloorFx)[keyof typeof FloorFx];

/** Mechanic presence bits (`hdr[Hdr.MECH]`), so classic arenas skip every floor pass. */
export const Mech = {
  ICE: 1,
  BELT: 2,
  TELEPORT: 4,
  TRAMPOLINE: 8,
  GROW: 16,
} as const;

/** Player ability bits (`abilities`). */
export const Ability = {
  KICK: 1,
  TOSS: 2,
  PIERCE: 4,
  SHIELD: 8,
} as const;

/** Jinx curse effects (`jinx`). 0 = none. */
export const Jinx = {
  NONE: 0,
  /** Directions are inverted. */
  REVERSED: 1,
  /** Half speed. */
  SLOW: 2,
  /** A bomb is placed automatically every `HASTE_INTERVAL` ticks. */
  HASTE: 3,
  /** Bombs cannot be placed. */
  NO_BOMB: 4,
} as const;
export const JINX_EFFECT_COUNT = 4;

/** Match phase (`hdr[Hdr.PHASE]`). PLAYING is 0 so hand-built test states play immediately. */
export const Phase = {
  /** Round running: movement, bombs, flames, sudden death. */
  PLAYING: 0,
  /** 3-2-1 before a round (`PHASE_TIMER` ticks left); nothing moves. */
  COUNTDOWN: 1,
  /** Round decided; flames fade out, next round after `PHASE_TIMER` ticks. */
  ROUND_OVER: 2,
  /** Match decided; the state is frozen (only the tick counter advances). */
  MATCH_OVER: 3,
} as const;

/** Rule flag bits (`hdr[Hdr.RULE_FLAGS]`). */
export const RuleFlag = {
  SUDDEN_DEATH: 1,
  GHOSTS: 2,
  FRIENDLY_FIRE: 4,
  TEAMS: 8,
  /** Warm-up sandbox (party lobby): flames and monsters never eliminate anybody. */
  HARMLESS: 16,
  /** Friendly rule (PLAN §1.12): a player's own flames never hurt them. */
  NO_SELF_DAMAGE: 32,
  /** Corner-assist strength: weaker / stronger than the default window (neither = default). */
  ASSIST_LOW: 64,
  ASSIST_HIGH: 128,
} as const;

/** Challenge monster kinds (`monKind`). 0 = no monster in the slot. */
export const Monster = {
  NONE: 0,
  /** Random walk, 1.5 tiles/s. */
  SNAIL: 1,
  /** Chases a seat within 5 tiles (path length), 3 tiles/s. */
  HOUND: 2,
  /** Random walk that hops over a crate or pillar every 3 s. */
  HOPPER: 3,
} as const;
export type MonsterKind = (typeof Monster)[keyof typeof Monster];
/** Monster slots in the state. */
export const MAX_MONSTERS = 6;

/** Bomb flag bits (`bombFlags`). */
export const BombFlag = {
  /** Exploding in the current tick (transient, cleared before `step` returns). */
  EXPLODING: 1,
  /** Dropped by a ghost (does not count against the owner's capacity). */
  GHOST: 2,
  /** Placed by a seat with the Pierce power-up: the flame passes through crates. */
  PIERCE: 4,
  /** Carried by a conveyor belt (slides at belt speed instead of kick speed). */
  BELT: 8,
} as const;

/** `aiGoal` value for "no goal". */
export const NO_GOAL = 255;

/** "No side" value for round / match winners (draw or undecided). */
export const NO_SIDE = -1;

/** Header slots (`hdr`, Int32). Append only. */
export const Hdr = {
  VERSION: 0,
  /** Number of `step` calls applied so far. */
  TICK: 1,
  PHASE: 2,
  PHASE_TIMER: 3,
  SEED: 4,
  /** Live bombs; `bomb*` arrays are compacted in creation order in [0, BOMB_COUNT). */
  BOMB_COUNT: 5,
  /** Bit `s` set ⇔ seat `s` takes part in the match. */
  SEAT_MASK: 6,
  /** Round number, 1-based (0 for hand-built states). */
  ROUND: 7,
  /** Playing ticks left before sudden death / time-out (only when ROUND_TICKS > 0). */
  ROUND_TIME: 8,
  /** Sudden-death blocks dropped so far (index into the spiral). */
  SD_INDEX: 9,
  /** Ticks until the next sudden-death block (0 = sudden death not running). */
  SD_TIMER: 10,
  /** Side that won the last round, `NO_SIDE` for a draw / undecided. */
  ROUND_WINNER: 11,
  /** Side that won the match, `NO_SIDE` while undecided. */
  MATCH_WINNER: 12,
  // Rules (constant for the whole match; part of the state so `step` needs nothing else).
  RULE_FLAGS: 13,
  /** Playing ticks per round before sudden death (0 = no time limit). */
  ROUND_TICKS: 14,
  WINS_TO_MATCH: 15,
  START_BOMBS: 16,
  START_RANGE: 17,
  START_SPEED: 18,
  POWERUP_CHANCE: 19,
  CRATE_DENSITY: 20,
  /** Bot difficulty per seat, 3 bits each (seat `s` at bit `3 s`); 0 = human / no bot. */
  BOT_CFG: 21,
  /** `Mech` bits present in the arena (constant for the match). */
  MECH: 22,
  /** Growing pillars: 0 = not started, −1 = all grown, else ticks until the next one grows. */
  GROW_TIMER: 23,
  /** Challenge flag: cell index of the goal, 0 = none (cell 0 is always wall). */
  GOAL_CELL: 24,
  /** `Ability` bits every seat starts each round with. */
  START_ABILITIES: 25,
} as const;
const HDR_LENGTH = 26;

export interface SimState {
  readonly buffer: ArrayBuffer;
  /** The whole state as bytes (snapshot / hash source). */
  readonly bytes: Uint8Array;
  readonly hdr: Int32Array;
  /** RNG streams, `RNG_WORDS` words each (see `rng.ts`). */
  readonly rng: Uint32Array;

  // Players, indexed by seat.
  /** Centre position in subunits. Invariant: aligned to a tile centre on at least one axis. */
  readonly px: Int32Array;
  readonly py: Int32Array;
  readonly alive: Uint8Array;
  /** Direction moved during the last tick (0 = stood still). */
  readonly moveDir: Uint8Array;
  /** Last direction the player tried to go (rendering, throws). */
  readonly facing: Uint8Array;
  /** Roller pickups collected (speed = BASE_SPEED + ROLLER_SPEED × level). */
  readonly speedLvl: Uint8Array;
  readonly bombCap: Uint8Array;
  readonly range: Uint8Array;
  readonly abilities: Uint8Array;
  /** Ticks left of a buffered bomb press. */
  readonly bombBuffer: Uint8Array;
  readonly team: Uint8Array;
  /** Active Jinx curse (`Jinx` effect id, 0 = none). */
  readonly jinx: Uint8Array;
  /** Ticks until a transferred curse may be passed on / taken again. */
  readonly jinxCd: Uint8Array;
  /** Bot: ticks until the next goal decision. */
  readonly aiTimer: Uint8Array;
  /** Bot: current goal cell (`NO_GOAL` = none). */
  readonly aiGoal: Uint8Array;
  /** Bot: 0 = pursuing a goal, 1 = escaping danger. */
  readonly aiMode: Uint8Array;
  readonly jinxTicks: Uint16Array;
  readonly invuln: Uint16Array;
  /** 1 while an eliminated seat haunts the outer wall (ghost revenge); position in px/py. */
  readonly ghost: Uint8Array;
  /** Ticks until the ghost may drop its next bomb. */
  readonly ghostCd: Uint16Array;
  /** Cell index of the seat's spawn (reused every round). */
  readonly spawnCell: Uint8Array;
  /** Rounds won, indexed by side (seat in free-for-all, team id in team mode). */
  readonly wins: Uint8Array;
  /** Subunits of ice glide left (0 = not gliding) and its direction. */
  readonly slideLeft: Uint16Array;
  readonly slideDir: Uint8Array;
  /** 1 while the seat stands on the pad it was just teleported onto (no instant bounce back). */
  readonly tpLock: Uint8Array;

  // Monsters (challenges), indexed by slot; `monKind` 0 = empty slot (SIM_VERSION 5).
  readonly monKind: Uint8Array;
  /** 1 while the monster lives. */
  readonly monAlive: Uint8Array;
  /** Tile the monster stands on / is leaving. */
  readonly monCell: Uint8Array;
  /** Tile it is walking (or hopping) to; equal to `monCell` while it rests. */
  readonly monNext: Uint8Array;
  /** Ticks until it arrives on `monNext`, and the length of the current step. */
  readonly monTimer: Uint8Array;
  readonly monSpan: Uint8Array;
  /** 1 while the current step is a hop. */
  readonly monJump: Uint8Array;
  /** Direction of the last step. */
  readonly monDir: Uint8Array;
  /** Hopper: ticks since the last hop. */
  readonly monAux: Uint16Array;

  // Bombs, compacted in creation order.
  readonly bombX: Int32Array;
  readonly bombY: Int32Array;
  readonly bombFuse: Uint16Array;
  readonly bombOwner: Uint8Array;
  readonly bombRange: Uint8Array;
  /** Bit `s` set ⇔ seat `s` may still walk through this bomb (it stood on the tile when placed). */
  readonly bombPass: Uint8Array;
  readonly bombFlags: Uint8Array;
  /** Slide direction of a kicked bomb (0 = resting). */
  readonly bombSlide: Uint8Array;

  // Grid layers, index = y * GRID_W + x.
  readonly tiles: Uint8Array;
  /** Power-up hidden under a crate. */
  readonly hidden: Uint8Array;
  /** Power-up lying open on the floor. */
  readonly pickup: Uint8Array;
  /** Ticks during which a freshly revealed pickup is immune to flames. */
  readonly pickupGrace: Uint8Array;
  /** Remaining lethal flame ticks. */
  readonly flame: Uint8Array;
  readonly flameOwner: Uint8Array;
  /** Static arena layout (`LayoutCell` per cell) used to rebuild the arena every round. */
  readonly layout: Uint8Array;
  /** Power-up weights per `Pickup` kind − 1 (resolved from arena / rules). */
  readonly weights: Uint16Array;
  /** `FloorFx` per cell (static). */
  readonly floor: Uint8Array;
  /** Teleport / tunnel pairing: cell index of the other pad (0 = none; cell 0 is always wall). */
  readonly partner: Uint8Array;
}

type FieldKind = 'i32' | 'u32' | 'u16' | 'u8';
type ViewName = Exclude<keyof SimState, 'buffer' | 'bytes'>;

const FIELDS: ReadonlyArray<readonly [ViewName, FieldKind, number]> = [
  // 4-byte fields first, then 2-byte, then 1-byte: natural alignment without padding.
  ['hdr', 'i32', HDR_LENGTH],
  ['rng', 'u32', RNG_STREAM_COUNT * RNG_WORDS],
  ['px', 'i32', MAX_SEATS],
  ['py', 'i32', MAX_SEATS],
  ['bombX', 'i32', MAX_BOMBS],
  ['bombY', 'i32', MAX_BOMBS],
  ['jinxTicks', 'u16', MAX_SEATS],
  ['invuln', 'u16', MAX_SEATS],
  ['ghostCd', 'u16', MAX_SEATS],
  ['bombFuse', 'u16', MAX_BOMBS],
  ['weights', 'u16', PICKUP_KIND_COUNT],
  ['slideLeft', 'u16', MAX_SEATS],
  ['monAux', 'u16', MAX_MONSTERS],
  ['alive', 'u8', MAX_SEATS],
  ['moveDir', 'u8', MAX_SEATS],
  ['facing', 'u8', MAX_SEATS],
  ['speedLvl', 'u8', MAX_SEATS],
  ['bombCap', 'u8', MAX_SEATS],
  ['range', 'u8', MAX_SEATS],
  ['abilities', 'u8', MAX_SEATS],
  ['bombBuffer', 'u8', MAX_SEATS],
  ['team', 'u8', MAX_SEATS],
  ['jinx', 'u8', MAX_SEATS],
  ['jinxCd', 'u8', MAX_SEATS],
  ['aiTimer', 'u8', MAX_SEATS],
  ['aiGoal', 'u8', MAX_SEATS],
  ['aiMode', 'u8', MAX_SEATS],
  ['ghost', 'u8', MAX_SEATS],
  ['spawnCell', 'u8', MAX_SEATS],
  ['wins', 'u8', MAX_SEATS],
  ['slideDir', 'u8', MAX_SEATS],
  ['tpLock', 'u8', MAX_SEATS],
  ['monKind', 'u8', MAX_MONSTERS],
  ['monAlive', 'u8', MAX_MONSTERS],
  ['monCell', 'u8', MAX_MONSTERS],
  ['monNext', 'u8', MAX_MONSTERS],
  ['monTimer', 'u8', MAX_MONSTERS],
  ['monSpan', 'u8', MAX_MONSTERS],
  ['monJump', 'u8', MAX_MONSTERS],
  ['monDir', 'u8', MAX_MONSTERS],
  ['bombOwner', 'u8', MAX_BOMBS],
  ['bombRange', 'u8', MAX_BOMBS],
  ['bombPass', 'u8', MAX_BOMBS],
  ['bombFlags', 'u8', MAX_BOMBS],
  ['bombSlide', 'u8', MAX_BOMBS],
  ['tiles', 'u8', CELL_COUNT],
  ['hidden', 'u8', CELL_COUNT],
  ['pickup', 'u8', CELL_COUNT],
  ['pickupGrace', 'u8', CELL_COUNT],
  ['flame', 'u8', CELL_COUNT],
  ['flameOwner', 'u8', CELL_COUNT],
  ['layout', 'u8', CELL_COUNT],
  ['floor', 'u8', CELL_COUNT],
  ['partner', 'u8', CELL_COUNT],
];

const BYTES: Record<FieldKind, number> = { i32: 4, u32: 4, u16: 2, u8: 1 };

/** Total state size in bytes (also the snapshot size). */
export const STATE_BYTES = FIELDS.reduce((sum, [, kind, n]) => sum + BYTES[kind] * n, 0);

function makeView(
  buffer: ArrayBuffer,
  kind: FieldKind,
  offset: number,
  n: number,
): Int32Array | Uint32Array | Uint16Array | Uint8Array {
  switch (kind) {
    case 'i32':
      return new Int32Array(buffer, offset, n);
    case 'u32':
      return new Uint32Array(buffer, offset, n);
    case 'u16':
      return new Uint16Array(buffer, offset, n);
    case 'u8':
      return new Uint8Array(buffer, offset, n);
  }
}

/** A zeroed state (all FLOOR, no seats) with the version stamped. Use `createState` for matches. */
export function createEmptyState(): SimState {
  const buffer = new ArrayBuffer(STATE_BYTES);
  const views: Partial<Record<ViewName, Int32Array | Uint32Array | Uint16Array | Uint8Array>> = {};
  let offset = 0;
  for (const [name, kind, n] of FIELDS) {
    views[name] = makeView(buffer, kind, offset, n);
    offset += BYTES[kind] * n;
  }
  const state = { buffer, bytes: new Uint8Array(buffer), ...views } as unknown as SimState;
  state.hdr[Hdr.VERSION] = SIM_VERSION;
  state.hdr[Hdr.ROUND_WINNER] = NO_SIDE;
  state.hdr[Hdr.MATCH_WINNER] = NO_SIDE;
  state.bombOwner.fill(NO_OWNER);
  state.flameOwner.fill(NO_OWNER);
  state.aiGoal.fill(NO_GOAL);
  return state;
}

/** Copies the whole state into a new byte array. */
export function snapshot(state: SimState): Uint8Array {
  return state.bytes.slice();
}

/** Copies the state into a preallocated `STATE_BYTES` buffer (allocation-free, for rollback rings). */
export function snapshotInto(state: SimState, out: Uint8Array): void {
  if (out.length !== STATE_BYTES) throw new RangeError('snapshotInto: wrong buffer size');
  out.set(state.bytes);
}

/** Overwrites `state` with a snapshot taken by `snapshot`/`snapshotInto`. */
export function restore(state: SimState, snap: Uint8Array): void {
  if (snap.length !== STATE_BYTES) throw new RangeError('restore: snapshot size mismatch');
  const version = new DataView(snap.buffer, snap.byteOffset, 4).getInt32(0, true);
  if (version !== SIM_VERSION) {
    throw new RangeError(`restore: snapshot is SIM_VERSION ${version}, expected ${SIM_VERSION}`);
  }
  state.bytes.set(snap);
}

/** A fresh, independent copy of `state`. */
export function cloneState(state: SimState): SimState {
  const copy = createEmptyState();
  copy.bytes.set(state.bytes);
  return copy;
}

/** FNV-1a over the whole state. Equal hashes ⇔ (practically) identical simulations. */
export function stateHash(state: SimState): number {
  return fnv1aBytes(FNV_OFFSET, state.bytes);
}

export function cellIndex(x: number, y: number): number {
  return y * GRID_W + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

/** Subunit coordinate of a tile centre. */
export function tileCenter(tile: number): number {
  return tile * TILE + HALF_TILE;
}

/** Tile containing a (non-negative) subunit coordinate. */
export function toTile(sub: number): number {
  return sub >> TILE_SHIFT;
}

export function isSeatActive(state: SimState, seat: number): boolean {
  return ((state.hdr[Hdr.SEAT_MASK] as number) & (1 << seat)) !== 0;
}

/** Seat's current tile (the tile containing its centre) as a cell index. */
export function playerCell(state: SimState, seat: number): number {
  return cellIndex(toTile(state.px[seat] as number), toTile(state.py[seat] as number));
}

/** The side a seat plays for: its team in team mode, otherwise the seat itself. */
export function sideOf(state: SimState, seat: number): number {
  return ((state.hdr[Hdr.RULE_FLAGS] as number) & RuleFlag.TEAMS) !== 0
    ? (state.team[seat] as number)
    : seat;
}
