import { Dir, type Direction } from '../core/input';

/** Seats the core supports (PLAN §1.4: 4 seats = 32 bits per tick). */
export const MAX_SEATS = 4;

/** One seat's decoded input for the tick being sampled. */
export interface SeatFrame {
  main: Direction;
  secondary: Direction;
  bomb: boolean;
}

/**
 * Something that turns device events into seat input. Sources are sampled in priority order
 * once per simulation tick: a source only fills a seat's direction if no earlier source did,
 * bomb presses are OR-ed, and sampling consumes the source's pending press edges.
 */
export interface InputSource {
  contribute(frames: readonly SeatFrame[]): void;
  /** Forget all held keys / touches (blur, layout change, pause). */
  reset(): void;
}

export function emptyFrames(): SeatFrame[] {
  return Array.from({ length: MAX_SEATS }, () => ({
    main: Dir.NONE,
    secondary: Dir.NONE,
    bomb: false,
  }));
}

/** Writes a direction pair into a frame unless an earlier source already steers that seat. */
export function offerDirection(frame: SeatFrame, main: Direction, secondary: Direction): void {
  if (frame.main !== Dir.NONE || main === Dir.NONE) return;
  frame.main = main;
  frame.secondary = secondary;
}
