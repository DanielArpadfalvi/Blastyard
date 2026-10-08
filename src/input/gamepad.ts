import { Dir, type Direction } from '../core/input';
import { type InputSource, MAX_SEATS, offerDirection, type SeatFrame } from './frame';
import { rotateDirection, type SeatOrientation } from './rotation';

/**
 * Gamepads (T5.5, PLAN §1.4 C): controllers polled once per simulation tick through a
 * {@link PadReader} (the DOM adapter wraps `navigator.getGamepads()`; tests pass fakes).
 *
 * - A controller is *unassigned* until one of its buttons is pressed; that press claims the first
 *   free seat of the running game (in seat order) and does nothing else. The claim stays across
 *   matches as long as the seat is a human seat of the next game, and ends when the controller
 *   disconnects.
 * - Standard mapping: D-pad (buttons 12–15) or the left stick moves – the larger stick axis is the
 *   main direction, the other one past a smaller threshold the turn intent; face buttons,
 *   bumpers and triggers (0–7) pop on the press edge.
 * - A gamepad is a relative device: directions are turned from the player's frame into the world
 *   by the seat orientation (like the keyboard).
 * - Lobby: holding a pop button counts like a resting finger in the zone (ready after 1 s).
 *
 * Pure: no DOM, no clock.
 */

/** The parts of a `Gamepad` this module reads. */
export interface PadSnapshot {
  readonly index: number;
  readonly connected: boolean;
  readonly buttons: ArrayLike<{ readonly pressed: boolean; readonly value?: number }>;
  readonly axes: ArrayLike<number>;
}

export type PadReader = () => ArrayLike<PadSnapshot | null | undefined>;

/** Stick deflection that steers (main axis) / that adds a turn intent (other axis). */
export const STICK_MAIN = 0.5;
export const STICK_SECONDARY = 0.35;

const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
/** Buttons that pop: A B X Y, bumpers, triggers. */
const POP_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7];
/** Buttons whose press claims a seat (pop buttons, D-pad, Start / Select). */
const CLAIM_BUTTONS = [...POP_BUTTONS, 8, 9, DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT];

interface PadState {
  /** Seat this pad steers, or −1 while unassigned. */
  seat: number;
  popHeld: boolean;
  anyHeld: boolean;
  bombPending: boolean;
  main: Direction;
  secondary: Direction;
}

function pressed(pad: PadSnapshot, i: number): boolean {
  const b = pad.buttons[i];
  return b !== undefined && (b.pressed || (b.value ?? 0) > 0.5);
}

/** Direction pair of a pad in the player's frame (D-pad first, then the left stick). */
export function padDirection(pad: PadSnapshot): { main: Direction; secondary: Direction } {
  const v = (pressed(pad, DPAD_DOWN) ? 1 : 0) - (pressed(pad, DPAD_UP) ? 1 : 0);
  const h = (pressed(pad, DPAD_RIGHT) ? 1 : 0) - (pressed(pad, DPAD_LEFT) ? 1 : 0);
  const x = h !== 0 || v !== 0 ? h : (pad.axes[0] ?? 0);
  const y = h !== 0 || v !== 0 ? v : (pad.axes[1] ?? 0);
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const horiz: Direction = x > 0 ? Dir.RIGHT : Dir.LEFT;
  const vert: Direction = y > 0 ? Dir.DOWN : Dir.UP;
  if (Math.max(ax, ay) < STICK_MAIN) return { main: Dir.NONE, secondary: Dir.NONE };
  if (ax >= ay) return { main: horiz, secondary: ay >= STICK_SECONDARY ? vert : Dir.NONE };
  return { main: vert, secondary: ax >= STICK_SECONDARY ? horiz : Dir.NONE };
}

export class GamepadSeats implements InputSource {
  /** Per pad index (pad indices are small and stable while connected). */
  private readonly pads: Array<PadState | undefined> = [];
  /** Human seats of the running game, in claim order, and their orientations. */
  private seats: number[] = [];
  private readonly orientation: SeatOrientation[] = [0, 0, 0, 0];
  private readonly listeners = new Set<() => void>();
  private claimVersion = 0;

  constructor(private readonly read: PadReader) {}

  /**
   * The human seats of the game that starts now. Claims of seats that are not among them are
   * released (the pad claims again with a press).
   */
  setSeats(seats: readonly { seat: number; orientation: SeatOrientation }[]): void {
    this.seats = seats.map((s) => s.seat);
    for (const s of seats) this.orientation[s.seat] = s.orientation;
    let changed = false;
    for (const pad of this.pads) {
      if (pad && pad.seat >= 0 && !this.seats.includes(pad.seat)) {
        pad.seat = -1;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  setOrientation(seat: number, orientation: SeatOrientation): void {
    if (seat >= 0 && seat < MAX_SEATS) this.orientation[seat] = orientation;
  }

  /** Seats that have a controller, ascending. */
  assignedSeats(): number[] {
    const out: number[] = [];
    for (const pad of this.pads)
      if (pad && pad.seat >= 0 && !out.includes(pad.seat)) out.push(pad.seat);
    return out.sort((a, b) => a - b);
  }

  /** Is a pop button held on the controller of `seat` (lobby ready hold)? */
  holding(seat: number): boolean {
    return this.pads.some((p) => p !== undefined && p.seat === seat && p.popHeld);
  }

  /** Called when a controller claims or loses a seat. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Bumped whenever a claim changes (cheap change detection for the HUD). */
  get version(): number {
    return this.claimVersion;
  }

  private emit(): void {
    this.claimVersion++;
    for (const fn of this.listeners) fn();
  }

  /** Reads every controller once: claims, held buttons, pop edges, directions. */
  poll(): void {
    let list: ArrayLike<PadSnapshot | null | undefined>;
    try {
      list = this.read();
    } catch {
      list = [];
    }
    const seen: boolean[] = [];
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const pad = list[i];
      if (!pad || !pad.connected) continue;
      seen[pad.index] = true;
      let state = this.pads[pad.index];
      if (!state) {
        state = {
          seat: -1,
          popHeld: false,
          anyHeld: false,
          bombPending: false,
          main: Dir.NONE,
          secondary: Dir.NONE,
        };
        this.pads[pad.index] = state;
      }
      const anyHeld = CLAIM_BUTTONS.some((b) => pressed(pad, b));
      const popHeld = POP_BUTTONS.some((b) => pressed(pad, b));
      if (state.seat < 0) {
        if (anyHeld && !state.anyHeld) {
          const taken = this.assignedSeats();
          const free = this.seats.find((s) => !taken.includes(s));
          if (free !== undefined) {
            state.seat = free;
            changed = true;
          }
        }
      } else if (popHeld && !state.popHeld) {
        state.bombPending = true;
      }
      state.anyHeld = anyHeld;
      state.popHeld = popHeld;
      const dir = state.seat >= 0 ? padDirection(pad) : { main: Dir.NONE, secondary: Dir.NONE };
      state.main = dir.main;
      state.secondary = dir.secondary;
    }
    for (let i = 0; i < this.pads.length; i++) {
      const state = this.pads[i];
      if (state && !seen[i]) {
        if (state.seat >= 0) changed = true;
        this.pads[i] = undefined;
      }
    }
    if (changed) this.emit();
  }

  contribute(frames: readonly SeatFrame[]): void {
    this.poll();
    for (const pad of this.pads) {
      if (!pad || pad.seat < 0 || pad.seat >= MAX_SEATS) continue;
      const frame = frames[pad.seat] as SeatFrame;
      const o = this.orientation[pad.seat] ?? 0;
      offerDirection(frame, rotateDirection(pad.main, o), rotateDirection(pad.secondary, o));
      if (pad.bombPending) frame.bomb = true;
      pad.bombPending = false;
    }
  }

  /** Forgets pending pops (pause, blur); claims stay. */
  reset(): void {
    for (const pad of this.pads) if (pad) pad.bombPending = false;
  }
}
