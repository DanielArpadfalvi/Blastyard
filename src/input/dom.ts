import type { PadReader } from './gamepad';
import type { KeyboardSeats } from './keyboard';
import type { TouchZones } from './zones';

/**
 * Thin DOM adapters: browser events → the pure input state machines. Coordinates are viewport
 * CSS pixels (`clientX/Y`), the same space the layout solver uses for zone rectangles.
 * Pointer listeners are passive (PLAN: input latency); scrolling and zooming are already
 * disabled by `touch-action: none` in the stylesheet.
 */

type Detach = () => void;

/** Time of a pointer event in ms, used for tap classification. */
export type PointerClock = (e: PointerEvent) => number;

/** Default: the event's own timestamp (when the touch happened, not when it was handled). */
export const eventTimeClock: PointerClock = (e) => e.timeStamp;

export function attachPointerInput(
  zones: TouchZones,
  target: Window = window,
  clock: PointerClock = eventTimeClock,
): Detach {
  const opts: AddEventListenerOptions = { passive: true };
  const down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    zones.pointerDown(e.pointerId, e.clientX, e.clientY, clock(e));
  };
  const move = (e: PointerEvent): void => zones.pointerMove(e.pointerId, e.clientX, e.clientY);
  const up = (e: PointerEvent): void =>
    zones.pointerUp(e.pointerId, e.clientX, e.clientY, clock(e));
  const cancel = (e: PointerEvent): void => zones.pointerCancel(e.pointerId);
  const drop = (): void => zones.reset();
  const visibility = (): void => {
    if (target.document.visibilityState === 'hidden') zones.reset();
  };

  target.addEventListener('pointerdown', down, opts);
  target.addEventListener('pointermove', move, opts);
  target.addEventListener('pointerup', up, opts);
  target.addEventListener('pointercancel', cancel, opts);
  target.addEventListener('blur', drop);
  target.document.addEventListener('visibilitychange', visibility);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('blur', drop);
    target.document.removeEventListener('visibilitychange', visibility);
  };
}

export function attachKeyboardInput(keyboard: KeyboardSeats, target: Window = window): Detach {
  const down = (e: KeyboardEvent): void => {
    if (!keyboard.handles(e.code)) return;
    // Keep Space/Enter from also activating a focused button while playing.
    e.preventDefault();
    keyboard.keyDown(e.code, e.repeat);
  };
  const up = (e: KeyboardEvent): void => keyboard.keyUp(e.code);
  const drop = (): void => keyboard.reset();

  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', drop);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', drop);
  };
}

/**
 * `navigator.getGamepads()` as a {@link PadReader} (empty where the Gamepad API is missing or
 * blocked, e.g. an insecure context or a permissions policy).
 */
export function webGamepads(nav: Navigator | undefined = globalThis.navigator): PadReader {
  return () => {
    try {
      return nav?.getGamepads?.() ?? [];
    } catch {
      return [];
    }
  };
}
