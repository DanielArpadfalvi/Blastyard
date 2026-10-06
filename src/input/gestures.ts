/** One-finger scheme tap (PLAN §1.4 B): a short, nearly still touch places a bomb. */
export interface TapParams {
  /** A tap must end strictly sooner than this after touch-down (ms). */
  maxMs: number;
  /** …and the finger must stay strictly closer than this to its touch-down point (dp). */
  maxTravel: number;
}

export const DEFAULT_TAP_PARAMS: TapParams = { maxMs: 180, maxTravel: 12 };

/** `durationMs`: touch-down to release; `travel`: the farthest the finger got from touch-down. */
export function isTap(
  durationMs: number,
  travel: number,
  params: TapParams = DEFAULT_TAP_PARAMS,
): boolean {
  return durationMs >= 0 && durationMs < params.maxMs && travel < params.maxTravel;
}
