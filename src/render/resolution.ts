/** Highest renderer resolution we use; above this the fill-rate cost outweighs the sharpness. */
export const MAX_RENDER_RESOLUTION = 2;

/**
 * Renderer resolution for a device pixel ratio: never below 1, capped at
 * {@link MAX_RENDER_RESOLUTION}; invalid input falls back to 1.
 */
export function renderResolution(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 1) return 1;
  return Math.min(devicePixelRatio, MAX_RENDER_RESOLUTION);
}
