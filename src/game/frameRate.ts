/**
 * Frame pacing and automatic effect quality (T3.3, PLAN §3.3).
 *
 * - {@link FramePacer} caps the frame rate (60 FPS in a match, 30 in menus) on any display rate:
 *   frames are accepted on a fixed schedule with a small tolerance, so a 60 Hz display never
 *   loses a frame to timer jitter and a 120/144 Hz display draws ~60 frames per second.
 * - {@link QualityGovernor} lowers the effect quality one step whenever the measured frame rate
 *   stays below {@link LOW_FPS} for {@link LOW_FPS_MS} of match time – two steps at once when it
 *   averaged below {@link SEVERE_FPS} (a device that slow gains nothing from the middle step).
 *
 * Pure (time is passed in), so both are unit-tested without a browser.
 */

export const MATCH_FPS_CAP = 60;
export const MENU_FPS_CAP = 30;

/** Accept a frame up to this early (ms): rAF timestamps jitter by a millisecond or two. */
export const PACER_TOLERANCE_MS = 2.5;

export class FramePacer {
  private next = -1;
  private intervalMs: number;

  constructor(cap = MATCH_FPS_CAP) {
    this.intervalMs = 1000 / cap;
  }

  setCap(fps: number): void {
    const cap = Number.isFinite(fps) && fps > 0 ? fps : MATCH_FPS_CAP;
    this.intervalMs = 1000 / cap;
    this.next = -1;
  }

  getCap(): number {
    return Math.round(1000 / this.intervalMs);
  }

  /** True if the frame at `now` (ms) should be simulated and drawn. */
  accept(now: number): boolean {
    if (this.next < 0 || now - this.next > this.intervalMs * 4) {
      // First frame, or back from a stall / background tab: restart the schedule.
      this.next = now + this.intervalMs;
      return true;
    }
    if (now < this.next - PACER_TOLERANCE_MS) return false;
    this.next += this.intervalMs;
    // Never let the schedule run ahead of the clock by more than one interval.
    if (this.next < now) this.next = now + this.intervalMs - PACER_TOLERANCE_MS;
    return true;
  }
}

/** Effect quality: 2 = full, 1 = reduced, 0 = minimal (see `render/effects.ts`). */
export type Quality = 0 | 1 | 2;
export const MAX_QUALITY: Quality = 2;

export const LOW_FPS = 50;
export const LOW_FPS_MS = 3000;
/** Below this mean frame rate over the slow spell, quality drops straight to minimal. */
export const SEVERE_FPS = 35;
/** Frame rate is measured over windows of this length. */
export const FPS_WINDOW_MS = 500;
/** Longer frames are stalls (tab switch, GC pause), not a slow device: they reset the window. */
export const STALL_MS = 250;

export class QualityGovernor {
  private quality: Quality;
  private windowMs = 0;
  private windowFrames = 0;
  private lowMs = 0;
  private lowFrames = 0;
  private lastFps = 0;

  constructor(
    private readonly onChange: (q: Quality) => void = () => undefined,
    initial: Quality = MAX_QUALITY,
  ) {
    this.quality = initial;
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** Frame rate of the latest complete window (0 before the first one). */
  getFps(): number {
    return this.lastFps;
  }

  /** Forgets the running measurement (new match, back from the background). */
  reset(): void {
    this.windowMs = 0;
    this.windowFrames = 0;
    this.lowMs = 0;
    this.lowFrames = 0;
  }

  /** Records one drawn frame that took `dtMs` since the previous one. */
  frame(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    if (dtMs > STALL_MS) {
      this.reset();
      return;
    }
    this.windowMs += dtMs;
    this.windowFrames++;
    if (this.windowMs < FPS_WINDOW_MS) return;
    const fps = (this.windowFrames * 1000) / this.windowMs;
    this.lastFps = fps;
    if (fps < LOW_FPS) {
      this.lowMs += this.windowMs;
      this.lowFrames += this.windowFrames;
    } else {
      this.lowMs = 0;
      this.lowFrames = 0;
    }
    this.windowMs = 0;
    this.windowFrames = 0;
    if (this.lowMs >= LOW_FPS_MS && this.quality > 0) {
      const meanFps = (this.lowFrames * 1000) / this.lowMs;
      const steps = meanFps < SEVERE_FPS ? 2 : 1;
      this.quality = Math.max(0, this.quality - steps) as Quality;
      this.lowMs = 0;
      this.lowFrames = 0;
      this.onChange(this.quality);
    }
  }
}
