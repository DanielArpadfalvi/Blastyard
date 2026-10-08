import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, LISTING, listingMarkdown, type Listing } from '../../scripts/storeListing';

/**
 * Names of the reference game and its series, base64-encoded so that this repository never
 * contains them in plain text (CLAUDE.md: original IP only).
 */
const BANNED = ['Ym9tYmVybWFu', 'Ym9tYmVyIG1hbg==', 'ZHluYWJsYXN0ZXI=', 'YXRvbWljIHB1bms=']
  .map((b) => Buffer.from(b, 'base64').toString('utf8'))
  .concat(['lite', 'demo', 'trial']);
const TRADEMARKS = BANNED.slice(0, 4);

const words = (s: string): string => s.toLowerCase();

describe('store listing (T9.1)', () => {
  for (const [lang, l] of Object.entries(LISTING) as [string, Listing][]) {
    it(`${lang}: within the store limits`, () => {
      expect(l.name.length).toBeLessThanOrEqual(LIMITS.name);
      expect(l.subtitle.length).toBeLessThanOrEqual(LIMITS.subtitle);
      expect(l.shortDescription.length).toBeLessThanOrEqual(LIMITS.shortDescription);
      expect(l.promo.length).toBeLessThanOrEqual(LIMITS.promo);
      expect(l.description.length).toBeLessThanOrEqual(LIMITS.description);
      expect(Buffer.byteLength(l.keywords, 'utf8')).toBeLessThanOrEqual(LIMITS.keywords);
      expect(l.whatsNew.length).toBeLessThanOrEqual(LIMITS.whatsNew);
      expect(l.keywords).not.toMatch(/\s/);
      expect(l.name).toMatch(/^Blastyard/);
    });

    it(`${lang}: the first line says what is free; no trademarks, no "Lite / Demo / Trial"`, () => {
      const first = l.description.split('\n')[0]!;
      expect(first).toMatch(lang === 'en' ? /^Free party game/ : /^Ingyenes party-játék/);
      expect(first).toMatch(/4/);
      const all = words(Object.values(l).join('\n'));
      for (const w of BANNED) expect(all, w).not.toMatch(new RegExp(`\\b${w}\\b`));
    });
  }

  it('docs/store-listing.md is generated from the source (npm run listing)', () => {
    expect(readFileSync('docs/store-listing.md', 'utf8')).toBe(listingMarkdown());
  });

  it('no reference-game trademark anywhere in the repository', () => {
    // Every tracked text file (code, content, i18n, docs, store texts, native projects) – except
    // the owner's market analysis in the plan, which names competitors on purpose.
    const hits = TRADEMARKS.flatMap((w) => {
      try {
        return execFileSync(
          'git',
          ['grep', '-I', '-i', '-l', '-e', w, '--', '.', ':!docs/PLAN.md'],
          { encoding: 'utf8' },
        )
          .split('\n')
          .filter(Boolean);
      } catch {
        return []; // git grep exits 1 when nothing matches
      }
    });
    expect(hits).toEqual([]);
  });
});
