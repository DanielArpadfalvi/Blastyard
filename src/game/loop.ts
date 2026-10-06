/**
 * Fixed-tick accumulator: turns real frame time into a whole number of 60 Hz simulation ticks
 * plus the render interpolation fraction. The game-speed option (70/85/100 %, PLAN §1.12) only
 * scales real time here, so simulation results never change.
 */

/** Simulation tick rate. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
/** Most ticks run for one frame; a longer stall (tab switch, GC) is dropped, not caught up. */
export const MAX_TICKS_PER_FRAME = 8;
/** Frame deltas above this are treated as a stall. */
export const MAX_FRAME_MS = 250;

export class FixedTickLoop {
  private acc = 0;
  private speed = 1;

  constructor(speed = 1) {
    this.setSpeed(speed);
  }

  /** Game speed factor, clamped to 0.25–2 (1 = real time). */
  setSpeed(speed: number): void {
    this.speed = Number.isFinite(speed) ? Math.min(2, Math.max(0.25, speed)) : 1;
  }

  getSpeed(): number {
    return this.speed;
  }

  /** Adds `dtMs` of real time; returns how many ticks to simulate now. */
  advance(dtMs: number): number {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, MAX_FRAME_MS) : 0;
    this.acc += dt * this.speed;
    let ticks = Math.floor(this.acc / TICK_MS);
    if (ticks > MAX_TICKS_PER_FRAME) {
      ticks = MAX_TICKS_PER_FRAME;
      this.acc = 0;
    } else {
      this.acc -= ticks * TICK_MS;
    }
    return ticks;
  }

  /** Fraction of a tick elapsed since the latest simulated tick (render interpolation), 0–1. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.acc / TICK_MS));
  }

  reset(): void {
    this.acc = 0;
  }
}
