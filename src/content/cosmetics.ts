/**
 * Cosmetic catalogue (T4.4, PLAN §1.8–§1.9): 12 Puffs (8 free, 4 Blastyard+), 18 hats, 9 pop skins
 * and 6 trails, all defined as code data – the renderer draws every item procedurally from these
 * records (`src/render/cosmetics.ts`). Cosmetics never change stats. There is no currency: free
 * items are unlocked by milestones (matches, wins, stars, daily streak), Plus items by Blastyard+.
 *
 * Seats are told apart by colour AND badge shape AND number (colour-blind friendly, PLAN §1.12);
 * those are fixed per seat and live here as `SEAT_BADGES`.
 */

export type Tier = 'free' | 'plus';

/** How a free item is earned. */
export type Unlock =
  | { readonly kind: 'start' }
  | { readonly kind: 'plus' }
  | { readonly kind: 'matches' | 'wins' | 'stars' | 'streak'; readonly n: number };

export interface CosmeticItem {
  readonly id: string;
  readonly unlock: Unlock;
}

export const START: Unlock = { kind: 'start' };
export const PLUS: Unlock = { kind: 'plus' };

export function tierOf(item: CosmeticItem): Tier {
  return item.unlock.kind === 'plus' ? 'plus' : 'free';
}

// ---------------------------------------------------------------------------------------------
// Seats

/** Badge shape per seat (circle, triangle, square, star); the number is the seat number + 1. */
export const SEAT_BADGES = ['circle', 'triangle', 'square', 'star'] as const;
export type BadgeShape = (typeof SEAT_BADGES)[number];

// ---------------------------------------------------------------------------------------------
// Puffs

export type Silhouette =
  | 'bunny'
  | 'antenna'
  | 'spikes'
  | 'duck'
  | 'horns'
  | 'sprout'
  | 'fin'
  | 'snout'
  | 'cat'
  | 'owl'
  | 'bat'
  | 'jelly';

export interface PuffDef extends CosmeticItem {
  readonly silhouette: Silhouette;
}

export const PUFFS: readonly PuffDef[] = [
  { id: 'bunny', silhouette: 'bunny', unlock: START },
  { id: 'antenna', silhouette: 'antenna', unlock: START },
  { id: 'spikes', silhouette: 'spikes', unlock: START },
  { id: 'duck', silhouette: 'duck', unlock: START },
  { id: 'horns', silhouette: 'horns', unlock: START },
  { id: 'sprout', silhouette: 'sprout', unlock: { kind: 'matches', n: 5 } },
  { id: 'fin', silhouette: 'fin', unlock: { kind: 'wins', n: 5 } },
  { id: 'snout', silhouette: 'snout', unlock: { kind: 'stars', n: 15 } },
  { id: 'cat', silhouette: 'cat', unlock: PLUS },
  { id: 'owl', silhouette: 'owl', unlock: PLUS },
  { id: 'bat', silhouette: 'bat', unlock: PLUS },
  { id: 'jelly', silhouette: 'jelly', unlock: PLUS },
];

// ---------------------------------------------------------------------------------------------
// Hats

export type HatShape =
  | 'cap'
  | 'party'
  | 'tophat'
  | 'headband'
  | 'beanie'
  | 'flower'
  | 'propeller'
  | 'chef'
  | 'antlers'
  | 'bow'
  | 'sailor'
  | 'helmet'
  | 'crown'
  | 'wizard'
  | 'cowboy'
  | 'halo'
  | 'pirate'
  | 'laurel';

export interface HatDef extends CosmeticItem {
  readonly shape: HatShape;
  readonly color: number;
  readonly accent: number;
}

export const HATS: readonly HatDef[] = [
  { id: 'cap', shape: 'cap', color: 0x3d8bff, accent: 0xffffff, unlock: START },
  { id: 'party', shape: 'party', color: 0xff5fa2, accent: 0xffd23f, unlock: START },
  {
    id: 'tophat',
    shape: 'tophat',
    color: 0x2f2f3d,
    accent: 0xff6b5b,
    unlock: { kind: 'matches', n: 3 },
  },
  {
    id: 'headband',
    shape: 'headband',
    color: 0xe63946,
    accent: 0xffffff,
    unlock: { kind: 'matches', n: 10 },
  },
  {
    id: 'beanie',
    shape: 'beanie',
    color: 0x4caf50,
    accent: 0xffffff,
    unlock: { kind: 'matches', n: 20 },
  },
  {
    id: 'flower',
    shape: 'flower',
    color: 0xff8fb3,
    accent: 0xffd23f,
    unlock: { kind: 'wins', n: 3 },
  },
  {
    id: 'propeller',
    shape: 'propeller',
    color: 0xffd23f,
    accent: 0xe63946,
    unlock: { kind: 'wins', n: 10 },
  },
  { id: 'chef', shape: 'chef', color: 0xffffff, accent: 0xd8d8e0, unlock: { kind: 'wins', n: 20 } },
  {
    id: 'antlers',
    shape: 'antlers',
    color: 0xa66a2d,
    accent: 0xf0b96f,
    unlock: { kind: 'stars', n: 10 },
  },
  { id: 'bow', shape: 'bow', color: 0xb57bff, accent: 0xffffff, unlock: { kind: 'stars', n: 20 } },
  {
    id: 'sailor',
    shape: 'sailor',
    color: 0xf4f1e8,
    accent: 0x2f74c4,
    unlock: { kind: 'stars', n: 30 },
  },
  {
    id: 'helmet',
    shape: 'helmet',
    color: 0x8d99ae,
    accent: 0xff6b5b,
    unlock: { kind: 'streak', n: 3 },
  },
  { id: 'crown', shape: 'crown', color: 0xffc83d, accent: 0xe63946, unlock: PLUS },
  { id: 'wizard', shape: 'wizard', color: 0x5b2a86, accent: 0xffd23f, unlock: PLUS },
  { id: 'cowboy', shape: 'cowboy', color: 0xb5793a, accent: 0xf0b96f, unlock: PLUS },
  { id: 'halo', shape: 'halo', color: 0xfff1a8, accent: 0xffc83d, unlock: PLUS },
  { id: 'pirate', shape: 'pirate', color: 0x2b2b35, accent: 0xf4f1e8, unlock: PLUS },
  { id: 'laurel', shape: 'laurel', color: 0x5fb04a, accent: 0xffd23f, unlock: PLUS },
];

// ---------------------------------------------------------------------------------------------
// Pop skins

export type PopPattern = 'none' | 'dots' | 'stripes' | 'stars' | 'hearts' | 'sparkle';

export interface PopSkinDef extends CosmeticItem {
  readonly body: number;
  readonly dark: number;
  readonly pattern: PopPattern;
  readonly mark: number;
}

export const POP_SKINS: readonly PopSkinDef[] = [
  { id: 'classic', body: 0x2ec4b6, dark: 0x1b8f85, pattern: 'none', mark: 0xffffff, unlock: START },
  {
    id: 'berry',
    body: 0xe8467c,
    dark: 0xa82a58,
    pattern: 'dots',
    mark: 0xffd1e0,
    unlock: { kind: 'matches', n: 5 },
  },
  {
    id: 'sun',
    body: 0xffc83d,
    dark: 0xd49a10,
    pattern: 'stripes',
    mark: 0xfff1a8,
    unlock: { kind: 'wins', n: 5 },
  },
  {
    id: 'mint',
    body: 0x7bdc9a,
    dark: 0x3fa66a,
    pattern: 'hearts',
    mark: 0xffffff,
    unlock: { kind: 'stars', n: 10 },
  },
  {
    id: 'candy',
    body: 0xff6b5b,
    dark: 0xc9483b,
    pattern: 'stripes',
    mark: 0xffffff,
    unlock: { kind: 'wins', n: 15 },
  },
  {
    id: 'night',
    body: 0x4a3f8f,
    dark: 0x2e2663,
    pattern: 'stars',
    mark: 0xfff1a8,
    unlock: { kind: 'streak', n: 5 },
  },
  { id: 'gold', body: 0xffc83d, dark: 0xb8860b, pattern: 'sparkle', mark: 0xffffff, unlock: PLUS },
  {
    id: 'galaxy',
    body: 0x2b2d6e,
    dark: 0x15163d,
    pattern: 'sparkle',
    mark: 0x9ff0e6,
    unlock: PLUS,
  },
  { id: 'frost', body: 0xa6d8ff, dark: 0x5aa0d8, pattern: 'stars', mark: 0xffffff, unlock: PLUS },
];

// ---------------------------------------------------------------------------------------------
// Trails

export type TrailParticle = 'dust' | 'spark' | 'star' | 'confetti' | 'smoke';

export interface TrailDef extends CosmeticItem {
  readonly particle: TrailParticle;
  /** Colours cycled through along the trail. */
  readonly tints: readonly number[];
  /** Ticks between two trail particles while the Puff moves. */
  readonly interval: number;
  /** Particle lifetime in ticks. */
  readonly life: number;
}

export const TRAILS: readonly TrailDef[] = [
  { id: 'dust', particle: 'dust', tints: [0xe9dcc0], interval: 6, life: 26, unlock: START },
  {
    id: 'leaves',
    particle: 'confetti',
    tints: [0x6cc551, 0x4fa83a, 0xa7e07a],
    interval: 7,
    life: 34,
    unlock: { kind: 'matches', n: 8 },
  },
  {
    id: 'bubbles',
    particle: 'smoke',
    tints: [0xbfe9ff, 0x9ff0e6],
    interval: 6,
    life: 36,
    unlock: { kind: 'wins', n: 8 },
  },
  {
    id: 'sparkle',
    particle: 'spark',
    tints: [0xfff1a8, 0xffffff],
    interval: 4,
    life: 24,
    unlock: { kind: 'stars', n: 12 },
  },
  {
    id: 'stars',
    particle: 'star',
    tints: [0xffd23f, 0xff8fb3, 0x9ff0e6],
    interval: 5,
    life: 30,
    unlock: { kind: 'streak', n: 4 },
  },
  {
    id: 'rainbow',
    particle: 'confetti',
    tints: [0xff5e3a, 0xffd23f, 0x4caf50, 0x4fa3ff, 0xb57bff],
    interval: 3,
    life: 30,
    unlock: PLUS,
  },
];

// ---------------------------------------------------------------------------------------------
// Selection

/** What a seat wears. Ids index the catalogues above; `null` = nothing. */
export interface Appearance {
  readonly puff: string;
  readonly hat: string | null;
  readonly pop: string;
  readonly trail: string | null;
}

/** Defaults: seat `s` is the s-th starter Puff, no hat, classic pop, no trail. */
export function defaultAppearance(seat: number): Appearance {
  return {
    puff: (PUFFS[seat % 4] as PuffDef).id,
    hat: null,
    pop: 'classic',
    trail: null,
  };
}

export function puffIndex(id: string): number {
  return Math.max(
    0,
    PUFFS.findIndex((p) => p.id === id),
  );
}
export function hatIndex(id: string | null): number {
  return id === null ? -1 : HATS.findIndex((h) => h.id === id);
}
export function popSkinIndex(id: string): number {
  return Math.max(
    0,
    POP_SKINS.findIndex((p) => p.id === id),
  );
}
export function trailIndex(id: string | null): number {
  return id === null ? -1 : TRAILS.findIndex((t) => t.id === id);
}
