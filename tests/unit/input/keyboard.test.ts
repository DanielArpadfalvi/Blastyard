import { describe, expect, it } from 'vitest';
import { Dir, encodeInput, INPUT_BOMB } from '../../../src/core/input';
import { InputController } from '../../../src/input/controller';
import { emptyFrames, type InputSource, type SeatFrame } from '../../../src/input/frame';
import { KeyboardSeats } from '../../../src/input/keyboard';

function sample(...sources: InputSource[]): number[] {
  return [...new InputController(sources).sample()];
}

describe('KeyboardSeats', () => {
  it('drives two seats: WASD + Space and arrows + Enter', () => {
    const kb = new KeyboardSeats();
    kb.keyDown('KeyD');
    kb.keyDown('ArrowUp');
    kb.keyDown('Enter');
    expect(sample(kb)).toEqual([encodeInput(Dir.RIGHT), encodeInput(Dir.UP, Dir.NONE, true), 0, 0]);
    expect(sample(kb)).toEqual([encodeInput(Dir.RIGHT), encodeInput(Dir.UP), 0, 0]);
  });

  it('latest held key is main, latest perpendicular one is secondary', () => {
    const kb = new KeyboardSeats();
    kb.keyDown('KeyW');
    kb.keyDown('KeyD');
    expect(sample(kb)[0]).toBe(encodeInput(Dir.RIGHT, Dir.UP));
    kb.keyUp('KeyD');
    expect(sample(kb)[0]).toBe(encodeInput(Dir.UP));
    kb.keyDown('KeyS'); // opposite: newest wins, no perpendicular secondary
    expect(sample(kb)[0]).toBe(encodeInput(Dir.DOWN));
    kb.keyUp('KeyS');
    kb.keyUp('KeyW');
    expect(sample(kb)[0]).toBe(0);
  });

  it('bomb fires on key-down only, auto-repeat ignored', () => {
    const kb = new KeyboardSeats();
    kb.keyDown('Space');
    kb.keyUp('Space');
    expect(sample(kb)[0]).toBe(INPUT_BOMB);
    kb.keyDown('Space', true);
    expect(sample(kb)[0]).toBe(0);
  });

  it('auto-repeat does not reorder held directions', () => {
    const kb = new KeyboardSeats();
    kb.keyDown('KeyW');
    kb.keyDown('KeyA');
    kb.keyDown('KeyW', true);
    expect(sample(kb)[0]).toBe(encodeInput(Dir.LEFT, Dir.UP));
  });

  it('rotates keys by the seat orientation and ignores unbound keys', () => {
    const kb = new KeyboardSeats([
      {
        seat: 2,
        up: ['KeyI'],
        right: ['KeyL'],
        down: ['KeyK'],
        left: ['KeyJ'],
        bomb: ['KeyU'],
        orientation: 90,
      },
    ]);
    expect(kb.handles('KeyI')).toBe(true);
    expect(kb.handles('KeyW')).toBe(false);
    kb.keyDown('KeyW');
    kb.keyDown('KeyI');
    expect(sample(kb)).toEqual([0, 0, encodeInput(Dir.RIGHT), 0]);
  });

  it('reset releases everything', () => {
    const kb = new KeyboardSeats();
    kb.keyDown('KeyW');
    kb.keyDown('Space');
    kb.reset();
    expect(sample(kb)).toEqual([0, 0, 0, 0]);
  });
});

describe('InputController', () => {
  const fixed = (main: number, bomb: boolean): InputSource => ({
    contribute(frames: readonly SeatFrame[]) {
      const f = frames[0] as SeatFrame;
      if (f.main === Dir.NONE && main !== Dir.NONE) f.main = main as SeatFrame['main'];
      if (bomb) f.bomb = true;
    },
    reset() {},
  });

  it('first source steering a seat wins, bombs are OR-ed', () => {
    expect(sample(fixed(Dir.UP, false), fixed(Dir.LEFT, true))[0]).toBe(
      encodeInput(Dir.UP, Dir.NONE, true),
    );
    expect(sample(fixed(Dir.NONE, false), fixed(Dir.LEFT, false))[0]).toBe(encodeInput(Dir.LEFT));
  });

  it('touch overrides keyboard for the same seat; keyboard fills idle seats', () => {
    const kb = new KeyboardSeats();
    kb.keyDown('KeyA');
    const touch = fixed(Dir.DOWN, false);
    expect(sample(touch, kb)[0]).toBe(encodeInput(Dir.DOWN));
    expect(sample(fixed(Dir.NONE, false), kb)[0]).toBe(encodeInput(Dir.LEFT));
  });

  it('writes into a caller buffer and clears stale frames each tick', () => {
    const kb = new KeyboardSeats();
    const controller = new InputController([kb]);
    const out = new Uint8Array(4);
    kb.keyDown('ArrowDown');
    expect(controller.sample(out)).toBe(out);
    expect([...out]).toEqual([0, encodeInput(Dir.DOWN), 0, 0]);
    kb.keyUp('ArrowDown');
    controller.sample(out);
    expect([...out]).toEqual([0, 0, 0, 0]);
    expect(emptyFrames()).toHaveLength(4);
  });
});
