import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES } from '../../src/i18n';

/**
 * T6.3: every user-visible string of the DOM UI goes through `src/i18n` (EN + HU). This walks the
 * TSX syntax tree of `src/ui/**` and fails on JSX text with letters and on string-literal
 * `aria-label` / `title` / `alt` / `placeholder` attributes. Symbols, numbers, unit symbols
 * (mm, dp, px) and the brand name are allowed.
 */
const UI_DIR = join(import.meta.dirname, '../../src/ui');
const VISIBLE_ATTRS = new Set(['aria-label', 'title', 'alt', 'placeholder']);
const LETTER = /\p{L}/u;
const ALLOWED = new Set(['Blastyard']);
/** Unit symbols read the same in every language. */
const UNITS = /\b(mm|dp|px)\b/g;
const visible = (text: string): boolean =>
  LETTER.test(text.replace(UNITS, '')) && !ALLOWED.has(text);

function findHardCoded(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf).trim();
      if (text && visible(text)) out.push(`${file}: text "${text}"`);
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      const name = node.name.getText(sf);
      const value = node.initializer.text;
      if (VISIBLE_ATTRS.has(name) && visible(value)) {
        out.push(`${file}: ${name}="${value}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
}

describe('i18n coverage', () => {
  it('self-test: the scanner catches hard-coded text and labels', () => {
    const found = findHardCoded(
      'x.tsx',
      `const a = <div title="Hello"><b>Play now</b>{t('ok')}<i aria-label={t('x')}>3 · ★</i></div>;`,
    );
    expect(found.sort()).toEqual(['x.tsx: text "Play now"', 'x.tsx: title="Hello"']);
  });

  it('the UI has no hard-coded user-visible strings', () => {
    const problems = readdirSync(UI_DIR)
      .filter((f) => f.endsWith('.tsx'))
      .flatMap((f) => findHardCoded(f, readFileSync(join(UI_DIR, f), 'utf8')));
    expect(problems).toEqual([]);
  });

  it('EN and HU use the same placeholders per key', () => {
    const mismatched = Object.entries(DICTIONARIES.en)
      .filter(([key, en]) => {
        const hu = DICTIONARIES.hu[key as keyof typeof DICTIONARIES.hu];
        return placeholders(en).join() !== placeholders(hu).join();
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });
});
