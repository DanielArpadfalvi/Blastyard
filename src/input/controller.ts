import { encodeInput } from '../core/input';
import { emptyFrames, type InputSource, MAX_SEATS, type SeatFrame } from './frame';

/**
 * Combines input sources into the per-tick seat bytes `step` consumes. Call `sample()` exactly
 * once per simulation tick: press edges collected since the previous tick are reported once.
 */
export class InputController {
  private readonly frames: SeatFrame[] = emptyFrames();

  /** Sources in priority order (the first one steering a seat wins its direction). */
  constructor(private readonly sources: readonly InputSource[]) {}

  sample(out: Uint8Array = new Uint8Array(MAX_SEATS)): Uint8Array {
    for (const frame of this.frames) {
      frame.main = 0;
      frame.secondary = 0;
      frame.bomb = false;
    }
    for (const source of this.sources) source.contribute(this.frames);
    for (let seat = 0; seat < MAX_SEATS && seat < out.length; seat++) {
      const f = this.frames[seat] as SeatFrame;
      out[seat] = encodeInput(f.main, f.secondary, f.bomb);
    }
    return out;
  }

  reset(): void {
    for (const source of this.sources) source.reset();
  }
}
