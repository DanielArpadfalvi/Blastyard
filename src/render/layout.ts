/**
 * Layout solver (PLAN §1.5): the square arena sits in the middle of the landscape screen, the two
 * side strips (control zones) left and right of it are never covered by the arena.
 *
 *   arena side = min(0.94 × height − HUD, width − 2 × max(38 mm + safe inset, 0.22 × width))
 *
 * The outer wall is drawn as a thin band (0.4 tile) so the 11 × 11 interior gets bigger tiles.
 * All values are CSS pixels (= dp on mobile WebViews). Pure: no DOM, no Pixi.
 */

import { GRID_W } from '../core';

/** dp per millimetre for the Android/iOS 160 dpi baseline (≈ 6.3, PLAN §1.4). */
export const DP_PER_MM = 160 / 25.4;
/** Minimum width of each side strip in millimetres (PLAN §1.5). */
export const MIN_STRIP_MM = 38;
/** Minimum side strip width as a fraction of the screen width. */
export const MIN_STRIP_FRACTION = 0.22;
/** Fraction of the screen height the arena may use at most. */
export const ARENA_HEIGHT_FRACTION = 0.94;
/** Height reserved for the top HUD band (timer, pause button), in dp. */
export const HUD_DP = 28;
/** Outer wall thickness in tiles. */
export const WALL_TILES = 0.4;
/** Interior cells per row (the 13 × 13 grid minus the outer wall). */
export const INTERIOR = GRID_W - 2;
/** Smallest tile we ever lay out (degenerate / portrait viewports). */
export const MIN_TILE_PX = 4;

export interface SafeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface LayoutInput {
  /** Viewport size in CSS px. */
  readonly width: number;
  readonly height: number;
  /** Safe-area insets in CSS px (notch, home indicator). */
  readonly safe?: SafeInsets;
  /** CSS px per millimetre (defaults to {@link DP_PER_MM}). */
  readonly dpPerMm?: number;
  /** Top HUD band height in CSS px (defaults to {@link HUD_DP}). */
  readonly hud?: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ArenaLayout {
  readonly width: number;
  readonly height: number;
  /** The whole arena square including the thin outer wall band. */
  readonly arena: Rect;
  /** Interior (11 × 11 playable cells) square. */
  readonly interior: Rect;
  /** Interior cell size in CSS px (an integer). */
  readonly tile: number;
  /** Outer wall band thickness in CSS px (an integer). */
  readonly wall: number;
  /** Side strips between the safe-area edge and the arena (control zones live here). */
  readonly leftStrip: Rect;
  readonly rightStrip: Rect;
  /** Narrower of the two strips in millimetres. */
  readonly stripMm: number;
  /** Interior tile size in millimetres. */
  readonly tileMm: number;
  readonly dpPerMm: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Solves the arena + side strip layout for a viewport. Always returns an on-screen arena. */
export function solveLayout(input: LayoutInput): ArenaLayout {
  const width = Math.max(1, finiteOr(input.width, 1));
  const height = Math.max(1, finiteOr(input.height, 1));
  const safe = input.safe ?? NO_INSETS;
  const safeL = finiteOr(safe.left, 0);
  const safeR = finiteOr(safe.right, 0);
  const safeT = finiteOr(safe.top, 0);
  const safeB = finiteOr(safe.bottom, 0);
  const dpPerMm = input.dpPerMm !== undefined && input.dpPerMm > 0 ? input.dpPerMm : DP_PER_MM;
  const hud = finiteOr(input.hud, HUD_DP);

  const minStrip = Math.max(
    MIN_STRIP_MM * dpPerMm + Math.max(safeL, safeR),
    MIN_STRIP_FRACTION * width,
  );
  const usableH = height - safeT - safeB;
  // +1 px per strip absorbs the rounding when centring the arena.
  const target = Math.min(ARENA_HEIGHT_FRACTION * usableH - hud, width - 2 * (minStrip + 1));

  // Integer tile and wall sizes keep sprites pixel-aligned.
  const tilesAcross = INTERIOR + 2 * WALL_TILES;
  const tile = Math.max(MIN_TILE_PX, Math.floor(target / tilesAcross));
  const wall = Math.max(1, Math.round(tile * WALL_TILES));
  const side = INTERIOR * tile + 2 * wall;

  const x = Math.max(0, Math.round((width - side) / 2));
  const top = safeT + hud;
  const y = Math.round(top + Math.max(0, height - safeB - top - side) / 2);
  const arena: Rect = { x, y, w: side, h: side };
  const interior: Rect = { x: x + wall, y: y + wall, w: INTERIOR * tile, h: INTERIOR * tile };

  const leftStrip: Rect = { x: safeL, y: safeT, w: Math.max(0, x - safeL), h: usableH };
  const rightX = x + side;
  const rightStrip: Rect = {
    x: rightX,
    y: safeT,
    w: Math.max(0, width - safeR - rightX),
    h: usableH,
  };

  return {
    width,
    height,
    arena,
    interior,
    tile,
    wall,
    leftStrip,
    rightStrip,
    stripMm: Math.min(leftStrip.w, rightStrip.w) / dpPerMm,
    tileMm: tile / dpPerMm,
    dpPerMm,
  };
}

/**
 * Screen position (CSS px) of a grid coordinate given in tiles (cell 0 = outer wall, cell 1 =
 * first interior cell). Interior cell `c` spans `[interior + (c − 1) × tile, … + tile)`; the
 * thin outer wall band is a compressed rendering of cells 0 and 12, so ghosts gliding along it
 * are drawn slightly outside the interior.
 */
export function gridToScreen(layout: ArenaLayout, tiles: number, axis: 'x' | 'y'): number {
  const origin = axis === 'x' ? layout.interior.x : layout.interior.y;
  return origin + (tiles - 1) * layout.tile;
}
