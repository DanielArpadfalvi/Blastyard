import { describe, expect, it } from 'vitest';
import { Dir, inputBomb, inputMain, inputSecondary } from '../../../src/core/input';
import { InputController } from '../../../src/input/controller';
import { GamepadSeats, padDirection, type PadSnapshot } from '../../../src/input/gamepad';
import { KeyboardSeats } from '../../../src/input/keyboard';

/** A fake standard-mapping controller. */
class FakePad implements PadSnapshot {
  connected = true;
  readonly buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  readonly axes = [0, 0, 0, 0];
  constructor(readonly index: number) {}
  press(i: number, down = true): this {
    this.buttons[i]!.pressed = down;
    this.buttons[i]!.value = down ? 1 : 0;
    return this;
  }
  stick(x: number, y: number): this {
    this.axes[0] = x;
    this.axes[1] = y;
    return this;
  }
}

function rig(pads: Array<FakePad | null>, seats = [0, 1]) {
  const gp = new GamepadSeats(() => pads);
  gp.setSeats(seats.map((seat) => ({ seat, orientation: 0 as const })));
  const ctl = new InputController([gp]);
  return { gp, sample: () => ctl.sample() };
}

describe('pad directions', () => {
  it('reads the D-pad first, then the left stick with a dead zone', () => {
    const pad = new FakePad(0);
    expect(padDirection(pad)).toEqual({ main: Dir.NONE, secondary: Dir.NONE });
    pad.stick(0.3, -0.2);
    expect(padDirection(pad).main).toBe(Dir.NONE);
    pad.stick(0.9, -0.4);
    expect(padDirection(pad)).toEqual({ main: Dir.RIGHT, secondary: Dir.UP });
    pad.stick(0.2, 0.8);
    expect(padDirection(pad)).toEqual({ main: Dir.DOWN, secondary: Dir.NONE });
    pad.press(14);
    expect(padDirection(pad)).toEqual({ main: Dir.LEFT, secondary: Dir.NONE });
    pad.press(12);
    expect(padDirection(pad)).toEqual({ main: Dir.LEFT, secondary: Dir.UP });
  });
});

describe('gamepad seats', () => {
  it('a press claims the first free seat and does nothing else', () => {
    const a = new FakePad(0);
    const b = new FakePad(1);
    const { gp, sample } = rig([a, b]);
    a.stick(1, 0);
    expect(inputMain(sample()[0]!)).toBe(Dir.NONE); // unassigned pads do not steer
    a.press(0);
    let out = sample();
    expect(gp.assignedSeats()).toEqual([0]);
    expect(inputBomb(out[0]!)).toBe(false); // the claiming press is not a pop
    expect(inputMain(out[0]!)).toBe(Dir.RIGHT);
    b.press(3);
    sample();
    expect(gp.assignedSeats()).toEqual([0, 1]);
    // A third pad finds no free seat.
    const { gp: full } = rig([a, b, new FakePad(2).press(0)]);
    full.poll();
    expect(full.assignedSeats()).toEqual([0, 1]);
    a.press(0, false);
    out = sample();
    expect(inputMain(out[0]!)).toBe(Dir.RIGHT);
  });

  it('pops on the press edge only, and holding counts for the lobby', () => {
    const a = new FakePad(0);
    const { gp, sample } = rig([a]);
    a.press(9);
    sample();
    a.press(9, false);
    sample();
    a.press(0);
    expect(inputBomb(sample()[0]!)).toBe(true);
    expect(inputBomb(sample()[0]!)).toBe(false);
    expect(gp.holding(0)).toBe(true);
    a.press(0, false);
    sample();
    expect(gp.holding(0)).toBe(false);
    a.press(7); // trigger
    expect(inputBomb(sample()[0]!)).toBe(true);
  });

  it('turns directions by the seat orientation (relative device)', () => {
    const a = new FakePad(0).press(12);
    const { gp, sample } = rig([a]);
    gp.setOrientation(0, 90);
    sample(); // claim
    expect(inputMain(sample()[0]!)).toBe(Dir.RIGHT); // "forward" for a player at the left edge
    a.stick(0.9, 0.5).press(12, false);
    gp.setOrientation(0, 180);
    const out = sample()[0]!;
    expect(inputMain(out)).toBe(Dir.LEFT);
    expect(inputSecondary(out)).toBe(Dir.UP);
  });

  it('keeps claims across games with the same seats, releases them otherwise and on disconnect', () => {
    const a = new FakePad(0).press(0);
    const pads: Array<FakePad | null> = [a];
    const { gp, sample } = rig(pads, [0, 1]);
    sample();
    expect(gp.assignedSeats()).toEqual([0]);
    const v = gp.version;
    gp.setSeats([{ seat: 0, orientation: 0 }]);
    expect(gp.assignedSeats()).toEqual([0]);
    gp.setSeats([{ seat: 2, orientation: 0 }]);
    expect(gp.assignedSeats()).toEqual([]);
    expect(gp.version).toBeGreaterThan(v);
    a.press(0, false);
    sample();
    a.press(0);
    sample();
    expect(gp.assignedSeats()).toEqual([2]);
    pads[0] = null;
    sample();
    expect(gp.assignedSeats()).toEqual([]);
  });

  it('touch / keyboard keep priority over a pad on the same seat; a throwing reader is harmless', () => {
    const a = new FakePad(0).press(0);
    const gp = new GamepadSeats(() => [a]);
    gp.setSeats([{ seat: 0, orientation: 0 }]);
    const keys = new KeyboardSeats();
    const ctl = new InputController([keys, gp]);
    ctl.sample();
    a.press(13);
    keys.keyDown('KeyD');
    expect(inputMain(ctl.sample()[0]!)).toBe(Dir.RIGHT);
    const broken = new GamepadSeats(() => {
      throw new Error('blocked');
    });
    expect(() => broken.poll()).not.toThrow();
  });
});
