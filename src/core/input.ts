/**
 * Per-seat input byte (one per seat per tick, PLAN §1.4):
 * bits 0–2 main direction (0 none, 1 up, 2 right, 3 down, 4 left), bits 3–5 secondary direction
 * (turn intent used by the corner assist / corridor sliding), bit 6 bomb press edge, bit 7 reserved.
 * Values 5–7 in a direction field are treated as "none". 4 seats pack into one uint32 per tick.
 */

export const Dir = {
  NONE: 0,
  UP: 1,
  RIGHT: 2,
  DOWN: 3,
  LEFT: 4,
} as const;
export type Direction = (typeof Dir)[keyof typeof Dir];

/** Tile delta per direction, indexed by `Direction`. */
export const DIR_DX: readonly number[] = [0, 0, 1, 0, -1];
export const DIR_DY: readonly number[] = [0, -1, 0, 1, 0];

export const INPUT_BOMB = 0x40;
export const NO_INPUT = 0;

function validDir(value: number): Direction {
  return value >= 1 && value <= 4 ? (value as Direction) : Dir.NONE;
}

export function encodeInput(
  main: Direction,
  secondary: Direction = Dir.NONE,
  bomb = false,
): number {
  return (main & 7) | ((secondary & 7) << 3) | (bomb ? INPUT_BOMB : 0);
}

export function inputMain(input: number): Direction {
  return validDir(input & 7);
}

export function inputSecondary(input: number): Direction {
  return validDir((input >> 3) & 7);
}

export function inputBomb(input: number): boolean {
  return (input & INPUT_BOMB) !== 0;
}

/** Horizontal direction? (RIGHT / LEFT) */
export function isHorizontal(dir: Direction): boolean {
  return dir === Dir.RIGHT || dir === Dir.LEFT;
}

/** Same axis, different direction, both non-none? */
export function isPerpendicular(a: Direction, b: Direction): boolean {
  return a !== Dir.NONE && b !== Dir.NONE && isHorizontal(a) !== isHorizontal(b);
}

/** Packs four seat bytes into one uint32 (seat 0 in the low byte) for logs and netcode. */
export function packInputs(inputs: ArrayLike<number>): number {
  let v = 0;
  for (let s = 0; s < 4; s++) v |= ((inputs[s] ?? 0) & 0xff) << (s * 8);
  return v >>> 0;
}

/** Inverse of `packInputs`, writing into `out` (length ≥ 4). */
export function unpackInputs(packed: number, out: Uint8Array): Uint8Array {
  for (let s = 0; s < 4; s++) out[s] = (packed >>> (s * 8)) & 0xff;
  return out;
}
