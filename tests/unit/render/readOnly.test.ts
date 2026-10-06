import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLASSIC_ARENAS } from '../../../src/content/arenas/classic';
import { MAX_SEATS, createState, stateHash, step } from '../../../src/core';
import { demoInput } from '../../../src/game/demoScript';
import { TickHistory } from '../../../src/render/interpolation';
import { Scene, extractScene } from '../../../src/render/scene';

/**
 * src/render must never mutate core state (CLAUDE.md, T2.1 AC). Three guards: the render layer
 * only sees `ReadonlySimState` (type level), ESLint bans importing core mutators into src/render,
 * and these tests (runtime + source scan).
 */

const RENDER_DIR = join(import.meta.dirname, '../../../src/render');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function runDemo(ticks: number, observe: ((tick: number) => void) | undefined): number[] {
  const state = createState({
    seed: 7,
    arena: CLASSIC_ARENAS[0]!,
    seats: [true, true, true, true],
  });
  const inputs = new Uint8Array(MAX_SEATS);
  const hashes: number[] = [];
  const history = new TickHistory();
  const scene = new Scene();
  for (let t = 0; t < ticks; t++) {
    for (let s = 0; s < MAX_SEATS; s++) inputs[s] = demoInput(state, s);
    history.capture(state);
    step(state, inputs);
    if (observe) {
      // Several frames per tick, like a 120 Hz display would draw.
      for (const alpha of [0, 0.37, 1]) extractScene(state, history, alpha, scene);
      observe(t);
    }
    hashes.push(stateHash(state));
  }
  return hashes;
}

describe('render never mutates core state', () => {
  it('scene extraction every frame leaves the simulation bit-identical', () => {
    let frames = 0;
    const observed = runDemo(1500, () => frames++);
    const plain = runDemo(1500, undefined);
    expect(frames).toBe(1500);
    expect(observed).toEqual(plain);
  });

  it('extraction does not change the state hash', () => {
    const state = createState({ seed: 3, arena: CLASSIC_ARENAS[1]!, seats: [true, true] });
    const before = stateHash(state);
    const bytes = state.bytes.slice();
    extractScene(state, new TickHistory(), 0.5, new Scene());
    new TickHistory().capture(state);
    expect(stateHash(state)).toBe(before);
    expect(state.bytes).toEqual(bytes);
  });

  it('src/render takes the state as ReadonlySimState and imports no mutators', () => {
    const offenders: string[] = [];
    for (const file of sources(RENDER_DIR)) {
      const rel = relative(RENDER_DIR, file);
      const text = readFileSync(file, 'utf8');
      if (rel === 'readonlyState.ts') continue;
      // A mutable `SimState` parameter / variable type.
      if (/:\s*SimState\b/.test(text)) offenders.push(`${rel}: SimState type`);
      if (/from\s+['"](\.\.\/)+core\/[^'"]+['"]/.test(text))
        offenders.push(`${rel}: deep core import`);
      const coreImport = /import\s*\{([^}]*)\}\s*from\s*['"](\.\.\/)+core['"]/.exec(text);
      const names = coreImport?.[1]?.split(',').map((n) => n.trim().replace(/^type\s+/, '')) ?? [];
      for (const banned of [
        'step',
        'restore',
        'addBomb',
        'removeBomb',
        'applyPickup',
        'movePlayer',
      ]) {
        if (names.includes(banned)) offenders.push(`${rel}: imports ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
