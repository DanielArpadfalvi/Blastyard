/**
 * "Playground backyard" palette (PLAN §1.13): warm saturated colours, thick dark outlines.
 * Seats are told apart by colour AND badge shape AND number (colour-blind friendly, PLAN §1.12).
 */

export const OUTLINE = 0x2b2118;
export const BACKDROP = 0x1b2a1e;

export const LAWN_A = 0x7cc35a;
export const LAWN_B = 0x70b84f;
export const LAWN_BLADE = 0x5fa344;
export const HEDGE = 0x3c7a38;
export const HEDGE_LIGHT = 0x529a47;
export const STRIP = 0x223626;
export const STRIP_EDGE = 0x2f4a33;

export const STONE = 0xa8a198;
export const STONE_TOP = 0xcbc5ba;
export const STONE_DARK = 0x7d776f;
export const WOOD = 0xdc9a4e;
export const WOOD_DARK = 0xa66a2d;
export const WOOD_LIGHT = 0xf0b96f;
export const BRICK = 0xb4583c;
export const BRICK_DARK = 0x86402c;

export const POP = 0x2ec4b6;
export const POP_DARK = 0x1b8f85;
export const POP_LIGHT = 0x9ff0e6;
export const POP_GHOST = 0xb9a7e8;
export const FUSE = 0xffb627;
export const FUSE_TRACK = 0x3a2f28;

export const FLAME_OUTER = 0xff5e3a;
export const FLAME_MID = 0xffa62b;
export const FLAME_CORE = 0xfff1a8;

export const SHADOW = 0x000000;
export const EYE_WHITE = 0xffffff;
export const PUPIL = 0x1d1712;
export const GHOST_TINT = 0xd8e4ff;

/**
 * Seat colours: coral, sky blue, sunflower, violet. Chosen to differ in brightness as well as hue
 * (relative luminance ≈ .33 / .48 / .68 / .19), so seats stay apart even in grayscale – on top of
 * the badge shape and number.
 */
export const SEAT_COLORS: readonly number[] = [0xff6b5b, 0x6dc0ff, 0xffd23f, 0x8f5bdc];
/** Darker shade per seat for silhouette details. */
export const SEAT_SHADES: readonly number[] = [0xc9483b, 0x3d8fd9, 0xd9a514, 0x6a3cb0];

export const PICKUP_BG = 0xfff6e0;
export const JINX_BG = 0x5b2a86;
