/**
 * Read-only view of the simulation state for the render layer.
 *
 * `src/render` must never mutate core state (CLAUDE.md). Typed arrays cannot be frozen, so the
 * renderer only ever sees the state through this type: every layer is an index-readable,
 * non-writable sequence without `set`/`fill`/`copyWithin`, which turns any accidental write into
 * a type error. A `SimState` is assignable to it, so callers just pass the live state.
 */

import type { SimState } from '../core';

/** An index-readable sequence of numbers with no mutating API. */
export interface ReadonlyNumbers {
  readonly [index: number]: number;
  readonly length: number;
}

export type ReadonlySimState = {
  readonly [K in Exclude<keyof SimState, 'buffer' | 'bytes'>]: ReadonlyNumbers;
};
