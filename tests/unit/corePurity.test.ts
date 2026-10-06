import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Belt-and-braces check next to the ESLint rules in eslint.config.js: src/core must stay pure
 * and deterministic (no clock, no Math.random, no DOM, no rendering/UI/native imports).
 */

const CORE_DIR = join(import.meta.dirname, '../../src/core');

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { name: 'Math.random', pattern: /\bMath\s*\.\s*random\b/ },
  { name: 'Date.now', pattern: /\bDate\s*\.\s*now\b/ },
  { name: 'new Date', pattern: /\bnew\s+Date\b/ },
  { name: 'performance.now', pattern: /\bperformance\s*\.\s*now\b/ },
  {
    name: 'DOM global',
    pattern:
      /(?<![\w$.])(window|document|navigator|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|HTMLCanvasElement)\b/,
  },
  {
    name: 'pixi/preact/capacitor import',
    pattern:
      /\bfrom\s+['"](pixi\.js|@pixi\/|preact|@capacitor\/)|\bimport\s*\(\s*['"](pixi\.js|@pixi\/|preact|@capacitor\/)|\bimport\s+['"](pixi\.js|@pixi\/|preact|@capacitor\/)/,
  },
  {
    name: 'outer-layer import',
    pattern: /['"](\.\.\/)+(game|render|input|audio|ui|platform|i18n|content|net)(\/|['"])/,
  },
];

/** Removes comments so documentation may mention forbidden APIs. Strings are kept. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

export function findViolations(source: string): string[] {
  const code = stripComments(source);
  return RULES.filter((r) => r.pattern.test(code)).map((r) => r.name);
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listTsFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe('core purity', () => {
  it('flags every forbidden pattern (self-test)', () => {
    const bad: Record<string, string> = {
      'Math.random': 'const x = Math.random();',
      'Date.now': 'const t = Date.now();',
      'new Date': 'const d = new Date();',
      'performance.now': 'const t = performance.now();',
      'DOM global': 'document.body.appendChild(el);',
      'pixi/preact/capacitor import': "import { Sprite } from 'pixi.js';",
      'outer-layer import': "import { draw } from '../render/world';",
    };
    for (const [name, snippet] of Object.entries(bad)) {
      expect(findViolations(snippet), snippet).toContain(name);
    }
    expect(findViolations("import { h } from 'preact';")).toContain('pixi/preact/capacitor import');
    expect(findViolations("await import('@capacitor/core');")).toContain(
      'pixi/preact/capacitor import',
    );
    expect(findViolations('window.addEventListener("x", f);')).toContain('DOM global');
  });

  it('accepts clean code and ignores comments', () => {
    const clean = [
      '// Never use Math.random or Date.now here; see rng.ts.',
      '/* document, window, performance.now() */',
      "import { createRng } from './rng';",
      'export const step = (state: { tick: number }) => { state.tick += 1; };',
      'const documentId = 3; const myWindow = 2;',
    ].join('\n');
    expect(findViolations(clean)).toEqual([]);
  });

  it('src/core contains no forbidden APIs or imports', () => {
    const files = listTsFiles(CORE_DIR);
    const problems = files.flatMap((file) =>
      findViolations(readFileSync(file, 'utf8')).map((v) => `${relative(CORE_DIR, file)}: ${v}`),
    );
    expect(problems).toEqual([]);
  });
});
