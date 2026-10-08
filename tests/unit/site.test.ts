import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGS, PAGE_IDS, fileName, renderSite } from '../../scripts/site';
import { DATA_FACTS, PAGES } from '../../scripts/siteContent';
import {
  PRIVACY_URL,
  SITE_URL,
  SUPPORT_URL,
  TERMS_URL,
  siteUrl,
  type SitePage,
} from '../../src/platform/links';

const site = renderSite(null);

describe('privacy & support site (T9.3)', () => {
  it('every link of the app resolves to a generated page, in both languages', () => {
    const files = [...site.keys()];
    for (const url of [PRIVACY_URL, SUPPORT_URL, TERMS_URL]) {
      expect(url.startsWith(`${SITE_URL}/`)).toBe(true);
      expect(files).toContain(url.slice(SITE_URL.length + 1));
    }
    for (const page of ['privacy', 'terms', 'support'] as SitePage[]) {
      for (const lang of LANGS) {
        expect(files).toContain(siteUrl(page, lang).slice(SITE_URL.length + 1));
      }
    }
    expect(files).toHaveLength(PAGE_IDS.length * LANGS.length);
  });

  it('pages are self-contained and link each other', () => {
    for (const [name, html] of site) {
      expect(html, name).toMatch(/^<!doctype html>/);
      expect(html, name).not.toMatch(/<script|<link rel="stylesheet"|https?:\/\/[^"]*\.(css|js)"/);
      for (const page of PAGE_IDS) {
        const lang = name.includes('-hu') ? 'hu' : 'en';
        expect(html, name).toContain(`href="${fileName(page, lang)}"`);
      }
      // Without SUPPORT_EMAIL the pages point to the store's developer contact.
      expect(html, name).not.toContain('{email}');
    }
    const withMail = renderSite('help@example.org').get('support.html')!;
    expect(withMail).toContain('<a href="mailto:help@example.org">help@example.org</a>');
  });

  it('the privacy policy matches the store privacy answers', () => {
    expect(DATA_FACTS).toMatchObject({
      analytics: false,
      ads: false,
      crashReporting: false,
      account: false,
      tracking: false,
    });
    const answers = readFileSync('docs/store-privacy-answers.md', 'utf8');
    expect(answers).toContain('**Purchase History**');
    expect(answers).toContain('**User ID**');
    expect(answers).toMatch(/Tracking: \*\*No\*\*/);
    for (const lang of LANGS) {
      const text = JSON.stringify(PAGES[lang].privacy);
      expect(text).toContain('RevenueCat');
      expect(text).toMatch(lang === 'en' ? /no analytics/i : /nincs analitika/i);
      expect(text).toMatch(
        lang === 'en' ? /anonymous app user ID/ : /névtelen felhasználói azonosító/,
      );
    }
  });
});
