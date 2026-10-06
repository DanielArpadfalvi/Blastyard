import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The input state machines (zones, stick, gestures, rotation, keyboard seats, controller) stay
 * DOM-free so they are unit-testable and reusable for gamepads; only the adapters may touch the
 * browser.
 */
const INPUT_DIR = join(import.meta.dirname, '../../../src/input');
const DOM_ADAPTERS = new Set(['dom.ts', 'testPage.ts']);

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['clock', /\b(Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now)\b/],
  [
    'DOM global',
    /(?<![\w$.])(window|document|navigator|localStorage|requestAnimationFrame|HTMLElement|PointerEvent|KeyboardEvent)\b/,
  ],
  ['pixi/preact import', /['"](pixi\.js|preact)['"]/],
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

describe('input purity', () => {
  it('self-test: catches DOM use', () => {
    expect(FORBIDDEN.some(([, re]) => re.test('window.addEventListener("x", f)'))).toBe(true);
  });

  it('pure input modules use no DOM, clock or randomness', () => {
    const problems = readdirSync(INPUT_DIR)
      .filter((f) => f.endsWith('.ts') && !DOM_ADAPTERS.has(f) && f !== 'index.ts')
      .flatMap((f) => {
        const code = stripComments(readFileSync(join(INPUT_DIR, f), 'utf8'));
        return FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => `${f}: ${name}`);
      });
    expect(problems).toEqual([]);
  });
});
