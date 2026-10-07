/**
 * Per-arena theme palettes (T4.3, PLAN §1.13). Every arena names a theme (`ArenaDef.theme`); the
 * theme recolours the floor, the outer hedge / wall band, pillars, crates and sudden-death blocks.
 * Shapes stay the same so the game reads identically on every arena (colour is never the only
 * cue). `garden` is the original backyard palette.
 */

import * as P from './palette';

export interface Theme {
  readonly id: string;
  readonly floorA: number;
  readonly floorB: number;
  /** Grass tufts / floor details. */
  readonly blade: number;
  /** Outer band (hedge, ice wall, steel plate…). */
  readonly hedge: number;
  readonly hedgeLight: number;
  readonly pillarBody: number;
  readonly pillarTop: number;
  readonly pillarCrack: number;
  readonly crateWood: number;
  readonly crateDark: number;
  readonly crateLight: number;
  readonly brick: number;
  readonly brickDark: number;
}

function theme(id: string, t: Partial<Theme>): Theme {
  return {
    id,
    floorA: P.LAWN_A,
    floorB: P.LAWN_B,
    blade: P.LAWN_BLADE,
    hedge: P.HEDGE,
    hedgeLight: P.HEDGE_LIGHT,
    pillarBody: P.STONE_DARK,
    pillarTop: P.STONE_TOP,
    pillarCrack: P.STONE,
    crateWood: P.WOOD,
    crateDark: P.WOOD_DARK,
    crateLight: P.WOOD_LIGHT,
    brick: P.BRICK,
    brickDark: P.BRICK_DARK,
    ...t,
  };
}

export const THEMES: readonly Theme[] = [
  theme('garden', {}),
  theme('meadow', {
    floorA: 0xa6d46e,
    floorB: 0x9bca62,
    blade: 0x7fb049,
    hedge: 0x4f8f3a,
    hedgeLight: 0x6fae4f,
  }),
  theme('courtyard', {
    floorA: 0xdcc9a0,
    floorB: 0xd0bd92,
    blade: 0xb9a578,
    hedge: 0x7a6247,
    hedgeLight: 0x9a8160,
    pillarBody: 0x8f7f6c,
    pillarTop: 0xc9b8a0,
    pillarCrack: 0xa89886,
  }),
  theme('stone', {
    floorA: 0xa0a6ae,
    floorB: 0x949aa3,
    blade: 0x7a808a,
    hedge: 0x575e68,
    hedgeLight: 0x7a828e,
    pillarBody: 0x5f656e,
    pillarTop: 0x9aa1ab,
    pillarCrack: 0x7d848e,
    brick: 0x7b6f9c,
    brickDark: 0x574d77,
  }),
  theme('ice', {
    floorA: 0xd2edf9,
    floorB: 0xc3e3f4,
    blade: 0xa3cde4,
    hedge: 0x5b9fc9,
    hedgeLight: 0x8cc9ea,
    pillarBody: 0x6fa9cf,
    pillarTop: 0xcdeafa,
    pillarCrack: 0x9ccbe6,
    crateWood: 0xd9b88a,
    crateDark: 0xa98354,
    crateLight: 0xf0d6ae,
    brick: 0x5f8fb0,
    brickDark: 0x41627c,
  }),
  theme('grove', {
    floorA: 0x5fae6a,
    floorB: 0x56a362,
    blade: 0x3f8650,
    hedge: 0x2e6b48,
    hedgeLight: 0x4a9561,
    pillarBody: 0x6c8c68,
    pillarTop: 0xa6c79c,
    pillarCrack: 0x86a67f,
    brick: 0x7a5aa6,
    brickDark: 0x553c7c,
  }),
  theme('factory', {
    floorA: 0x939da9,
    floorB: 0x8892a0,
    blade: 0x6f7986,
    hedge: 0x4a5361,
    hedgeLight: 0x6d7a8b,
    pillarBody: 0x6b7686,
    pillarTop: 0xaeb9c8,
    pillarCrack: 0x8794a4,
    crateWood: 0xe0923f,
    crateDark: 0xa05e1e,
    crateLight: 0xf5b56a,
    brick: 0x6c7480,
    brickDark: 0x484f59,
  }),
  theme('tunnel', {
    floorA: 0x91755a,
    floorB: 0x866b51,
    blade: 0x6d553e,
    hedge: 0x3b2f27,
    hedgeLight: 0x5d4a3d,
    pillarBody: 0x5f5043,
    pillarTop: 0x93806b,
    pillarCrack: 0x786654,
  }),
  theme('bounce', {
    floorA: 0xf7c97e,
    floorB: 0xf0bd6c,
    blade: 0xd99c4a,
    hedge: 0xdc4a74,
    hedgeLight: 0xff86a5,
    pillarBody: 0x8f5fd6,
    pillarTop: 0xcfb0ff,
    pillarCrack: 0xb08aea,
    brick: 0xe0577a,
    brickDark: 0xa83358,
  }),
  theme('rubble', {
    floorA: 0xad9d8a,
    floorB: 0xa29280,
    blade: 0x86765f,
    hedge: 0x5b4b3d,
    hedgeLight: 0x7e6a58,
    pillarBody: 0x7a7066,
    pillarTop: 0xb3a899,
    pillarCrack: 0x948a7c,
    crateWood: 0xb5793a,
    crateDark: 0x7f4f21,
    crateLight: 0xd49c5b,
    brick: 0x8a5a44,
    brickDark: 0x5f3b2c,
  }),
  theme('maze', {
    floorA: 0x6aa85a,
    floorB: 0x619f52,
    blade: 0x4a8a3e,
    hedge: 0x23512a,
    hedgeLight: 0x3b7b40,
    pillarBody: 0x2f6b34,
    pillarTop: 0x55a054,
    pillarCrack: 0x3f8341,
    brick: 0x3f6f3f,
    brickDark: 0x274a2a,
  }),
  theme('mixed', {
    floorA: 0x74c9ba,
    floorB: 0x68bdaf,
    blade: 0x4fa396,
    hedge: 0x2e7f78,
    hedgeLight: 0x4fb0a6,
    pillarBody: 0xa493c9,
    pillarTop: 0xd9cdf0,
    pillarCrack: 0xbbaadc,
    brick: 0x9a5fb0,
    brickDark: 0x6a3a7e,
  }),
];

const BY_ID = new Map(THEMES.map((t) => [t.id, t] as const));

/** The theme with this id (the garden palette for unknown ids). */
export function themeFor(id: string): Theme {
  return BY_ID.get(id) ?? (THEMES[0] as Theme);
}
