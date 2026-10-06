import { Dir, type Direction, isHorizontal } from '../core/input';
import { type InputSource, MAX_SEATS, offerDirection, type SeatFrame } from './frame';
import { rotateDirection, type SeatOrientation } from './rotation';

/** Key bindings for one keyboard seat, as `KeyboardEvent.code` values. */
export interface KeyBinding {
  seat: number;
  up: readonly string[];
  right: readonly string[];
  down: readonly string[];
  left: readonly string[];
  bomb: readonly string[];
  /** Rotates the keys from the player's frame into the world (default 0: screen frame). */
  orientation?: SeatOrientation;
}

/** PLAN §1.4 C: WASD + Space and arrows + Enter – two seats for desktop testing. */
export const DEFAULT_KEY_BINDINGS: readonly KeyBinding[] = [
  { seat: 0, up: ['KeyW'], right: ['KeyD'], down: ['KeyS'], left: ['KeyA'], bomb: ['Space'] },
  {
    seat: 1,
    up: ['ArrowUp'],
    right: ['ArrowRight'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    bomb: ['Enter', 'NumpadEnter'],
  },
];

interface KeySeat {
  binding: KeyBinding;
  /** Held direction keys (seat-local), most recent last. */
  held: Direction[];
  bombPending: boolean;
}

/**
 * Keyboard seats: the most recently pressed held direction is the main one, the most recent
 * held key on the other axis is the secondary (turn intent). Bomb reacts to the key-down edge;
 * auto-repeat is ignored.
 */
export class KeyboardSeats implements InputSource {
  private readonly seats: KeySeat[];
  private readonly lookup = new Map<string, { seat: number; dir: Direction | 'bomb' }>();

  constructor(bindings: readonly KeyBinding[] = DEFAULT_KEY_BINDINGS) {
    this.seats = bindings.map((binding) => ({ binding, held: [], bombPending: false }));
    this.seats.forEach(({ binding }, i) => {
      const add = (codes: readonly string[], dir: Direction | 'bomb'): void => {
        for (const code of codes) this.lookup.set(code, { seat: i, dir });
      };
      add(binding.up, Dir.UP);
      add(binding.right, Dir.RIGHT);
      add(binding.down, Dir.DOWN);
      add(binding.left, Dir.LEFT);
      add(binding.bomb, 'bomb');
    });
  }

  /** Whether `code` is bound (adapters may suppress the browser default for it). */
  handles(code: string): boolean {
    return this.lookup.has(code);
  }

  keyDown(code: string, repeat = false): void {
    const hit = this.lookup.get(code);
    if (!hit) return;
    const seat = this.seats[hit.seat] as KeySeat;
    if (hit.dir === 'bomb') {
      if (!repeat) seat.bombPending = true;
      return;
    }
    const at = seat.held.indexOf(hit.dir);
    if (at >= 0) {
      if (repeat) return;
      seat.held.splice(at, 1);
    }
    seat.held.push(hit.dir);
  }

  keyUp(code: string): void {
    const hit = this.lookup.get(code);
    if (!hit || hit.dir === 'bomb') return;
    const seat = this.seats[hit.seat] as KeySeat;
    const at = seat.held.indexOf(hit.dir);
    if (at >= 0) seat.held.splice(at, 1);
  }

  reset(): void {
    for (const seat of this.seats) {
      seat.held.length = 0;
      seat.bombPending = false;
    }
  }

  contribute(frames: readonly SeatFrame[]): void {
    for (const seat of this.seats) {
      const index = seat.binding.seat;
      if (index < 0 || index >= MAX_SEATS) continue;
      const frame = frames[index] as SeatFrame;
      const main = seat.held[seat.held.length - 1] ?? Dir.NONE;
      let secondary: Direction = Dir.NONE;
      if (main !== Dir.NONE) {
        for (let i = seat.held.length - 2; i >= 0; i--) {
          const d = seat.held[i] as Direction;
          if (isHorizontal(d) !== isHorizontal(main)) {
            secondary = d;
            break;
          }
        }
      }
      const o = seat.binding.orientation ?? 0;
      offerDirection(frame, rotateDirection(main, o), rotateDirection(secondary, o));
      if (seat.bombPending) frame.bomb = true;
      seat.bombPending = false;
    }
  }
}
