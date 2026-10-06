import { Dir, type Direction } from '../core/input';

/** Floating-stick tuning (PLAN §1.4). Distances in dp. */
export interface StickParams {
  /** No direction while the finger is closer than this to the stick centre. */
  deadZone: number;
  /**
   * Total width of the hysteresis band around the 45° diagonals: the current axis is kept until
   * the vector is more than half of this past the diagonal, so the main direction does not
   * flicker when the thumb hovers near a diagonal.
   */
  hysteresisDeg: number;
  /** The smaller component becomes the secondary direction when above this share of the main. */
  secondaryRatio: number;
  /** The stick centre follows the finger once it is farther than this (no "running out"). */
  followRadius: number;
}

export const DEFAULT_STICK_PARAMS: StickParams = {
  deadZone: 12,
  hysteresisDeg: 15,
  secondaryRatio: 0.35,
  followRadius: 60,
};

export interface StickReading {
  main: Direction;
  secondary: Direction;
}

const NEUTRAL: StickReading = { main: Dir.NONE, secondary: Dir.NONE };

function horizontalDir(dx: number): Direction {
  return dx >= 0 ? Dir.RIGHT : Dir.LEFT;
}

function verticalDir(dy: number): Direction {
  return dy >= 0 ? Dir.DOWN : Dir.UP;
}

/**
 * Classifies a stick vector (screen space, +y down) into a main and a secondary direction.
 * `prevMain` is the previous reading's main direction, used for the hysteresis.
 */
export function classifyStick(
  dx: number,
  dy: number,
  prevMain: Direction,
  params: StickParams = DEFAULT_STICK_PARAMS,
): StickReading {
  if (Math.hypot(dx, dy) < params.deadZone) return NEUTRAL;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const keep = Math.tan(((45 + params.hysteresisDeg / 2) * Math.PI) / 180);
  let horizontal: boolean;
  if (prevMain === Dir.LEFT || prevMain === Dir.RIGHT) horizontal = ay <= ax * keep;
  else if (prevMain === Dir.UP || prevMain === Dir.DOWN) horizontal = !(ax <= ay * keep);
  else horizontal = ax >= ay;

  const mainMag = horizontal ? ax : ay;
  const otherMag = horizontal ? ay : ax;
  const main = horizontal ? horizontalDir(dx) : verticalDir(dy);
  const secondary =
    otherMag > 0 && otherMag > params.secondaryRatio * mainMag
      ? horizontal
        ? verticalDir(dy)
        : horizontalDir(dx)
      : Dir.NONE;
  return { main, secondary };
}

/** A floating stick: the touch-down point becomes the centre, which follows a far finger. */
export class FloatingStick {
  active = false;
  /** Stick centre (screen dp). */
  cx = 0;
  cy = 0;
  /** Current finger position (screen dp). */
  x = 0;
  y = 0;
  main: Direction = Dir.NONE;
  secondary: Direction = Dir.NONE;

  constructor(readonly params: StickParams = DEFAULT_STICK_PARAMS) {}

  press(x: number, y: number): void {
    this.active = true;
    this.cx = this.x = x;
    this.cy = this.y = y;
    this.main = Dir.NONE;
    this.secondary = Dir.NONE;
  }

  move(x: number, y: number): void {
    if (!this.active) return;
    this.x = x;
    this.y = y;
    let dx = x - this.cx;
    let dy = y - this.cy;
    const dist = Math.hypot(dx, dy);
    const radius = this.params.followRadius;
    if (dist > radius) {
      const pull = (dist - radius) / dist;
      this.cx += dx * pull;
      this.cy += dy * pull;
      dx = x - this.cx;
      dy = y - this.cy;
    }
    const reading = classifyStick(dx, dy, this.main, this.params);
    this.main = reading.main;
    this.secondary = reading.secondary;
  }

  release(): void {
    this.active = false;
    this.main = Dir.NONE;
    this.secondary = Dir.NONE;
  }
}
