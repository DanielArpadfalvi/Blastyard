import { describe, expect, it } from 'vitest';
import { Dir } from '../../../src/core/input';
import { isTap } from '../../../src/input/gestures';
import { classifyStick, DEFAULT_STICK_PARAMS, FloatingStick } from '../../../src/input/stick';

/** Vector of length `len` at `deg` degrees clockwise from screen-right (+y is down). */
function polar(deg: number, len = 40): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r) * len, Math.sin(r) * len];
}

describe('classifyStick', () => {
  it('reports nothing inside the 12 dp dead zone', () => {
    expect(classifyStick(11.9, 0, Dir.NONE)).toEqual({ main: Dir.NONE, secondary: Dir.NONE });
    expect(classifyStick(8, 8, Dir.RIGHT)).toEqual({ main: Dir.NONE, secondary: Dir.NONE });
    expect(classifyStick(12, 0, Dir.NONE).main).toBe(Dir.RIGHT);
  });

  it('picks the larger component from rest', () => {
    expect(classifyStick(30, 5, Dir.NONE).main).toBe(Dir.RIGHT);
    expect(classifyStick(-30, 5, Dir.NONE).main).toBe(Dir.LEFT);
    expect(classifyStick(5, -30, Dir.NONE).main).toBe(Dir.UP);
    expect(classifyStick(5, 30, Dir.NONE).main).toBe(Dir.DOWN);
  });

  it('keeps the current axis within the 15° hysteresis band', () => {
    // 50° below horizontal: vertical from rest, but a held RIGHT survives (switch at 52.5°).
    const [x50, y50] = polar(50);
    expect(classifyStick(x50, y50, Dir.NONE).main).toBe(Dir.DOWN);
    expect(classifyStick(x50, y50, Dir.RIGHT).main).toBe(Dir.RIGHT);
    // …and a held DOWN survives 40° (i.e. 50° from vertical).
    const [x40, y40] = polar(40);
    expect(classifyStick(x40, y40, Dir.NONE).main).toBe(Dir.RIGHT);
    expect(classifyStick(x40, y40, Dir.DOWN).main).toBe(Dir.DOWN);
    // Past the band the axis switches.
    const [x55, y55] = polar(55);
    expect(classifyStick(x55, y55, Dir.RIGHT).main).toBe(Dir.DOWN);
    const [x35, y35] = polar(35);
    expect(classifyStick(x35, y35, Dir.DOWN).main).toBe(Dir.RIGHT);
  });

  it('flips sign on the same axis without hysteresis', () => {
    expect(classifyStick(-30, 2, Dir.RIGHT).main).toBe(Dir.LEFT);
    expect(classifyStick(2, 30, Dir.UP).main).toBe(Dir.DOWN);
  });

  it('reports the smaller component as secondary above 35% of the main', () => {
    expect(classifyStick(40, 13, Dir.NONE)).toEqual({ main: Dir.RIGHT, secondary: Dir.NONE });
    expect(classifyStick(40, 15, Dir.NONE)).toEqual({ main: Dir.RIGHT, secondary: Dir.DOWN });
    expect(classifyStick(-15, -40, Dir.NONE)).toEqual({ main: Dir.UP, secondary: Dir.LEFT });
    // Under hysteresis the secondary may even be the larger component.
    const [x, y] = polar(50);
    expect(classifyStick(x, y, Dir.RIGHT)).toEqual({ main: Dir.RIGHT, secondary: Dir.DOWN });
  });
});

describe('FloatingStick', () => {
  it('centres on the touch-down point and steers relative to it', () => {
    const s = new FloatingStick();
    s.press(100, 100);
    expect(s.main).toBe(Dir.NONE);
    s.move(105, 104);
    expect(s.main).toBe(Dir.NONE);
    s.move(100, 70);
    expect(s.main).toBe(Dir.UP);
    s.release();
    expect([s.active, s.main, s.secondary]).toEqual([false, Dir.NONE, Dir.NONE]);
  });

  it('applies hysteresis across consecutive moves', () => {
    const s = new FloatingStick();
    s.press(0, 0);
    s.move(40, 0);
    expect(s.main).toBe(Dir.RIGHT);
    const [x, y] = polar(50);
    s.move(x, y);
    expect(s.main).toBe(Dir.RIGHT);
    s.move(...polar(60));
    expect(s.main).toBe(Dir.DOWN);
    s.move(x, y);
    expect(s.main).toBe(Dir.DOWN);
  });

  it('follows the finger beyond 60 dp so a reversal reacts at once', () => {
    const s = new FloatingStick();
    s.press(0, 0);
    s.move(200, 0);
    expect(s.cx).toBeCloseTo(200 - DEFAULT_STICK_PARAMS.followRadius);
    expect(s.cy).toBe(0);
    expect(s.main).toBe(Dir.RIGHT);
    // The centre was dragged to x = 140: a 20 dp return still points right of it, an 80 dp
    // return (not the original 200 dp) already steers left.
    s.move(180, 0);
    expect(s.main).toBe(Dir.RIGHT);
    s.move(120, 0);
    expect(s.main).toBe(Dir.LEFT);
    expect(s.cx).toBeCloseTo(140);
  });

  it('ignores moves while released', () => {
    const s = new FloatingStick();
    s.move(50, 0);
    expect(s.main).toBe(Dir.NONE);
  });
});

describe('isTap', () => {
  it('needs < 180 ms and < 12 dp', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(179, 11.9)).toBe(true);
    expect(isTap(180, 0)).toBe(false);
    expect(isTap(100, 12)).toBe(false);
    expect(isTap(-1, 0)).toBe(false);
  });
});
