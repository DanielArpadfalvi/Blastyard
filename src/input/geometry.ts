/**
 * Screen geometry for touch input. All coordinates are viewport CSS pixels (= dp, PLAN §1.4);
 * physical sizes in mm are converted with a dp-per-mm factor the layout solver derives from the
 * device (PLAN assumes ≈ 6.3 dp/mm when nothing better is known).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fallback density when the caller does not know the real one (PLAN §1.4). */
export const DEFAULT_DP_PER_MM = 6.3;

export function mmToDp(mm: number, dpPerMm = DEFAULT_DP_PER_MM): number {
  return mm * dpPerMm;
}

/** Half-open containment: the right/bottom edge belongs to the neighbour. */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** Euclidean distance from a point to a rectangle (0 inside). */
export function distanceToRect(r: Rect, x: number, y: number): number {
  const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
  const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
  return Math.hypot(dx, dy);
}
