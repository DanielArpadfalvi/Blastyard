// Renders the privacy / terms / support site (T9.3) from scripts/siteContent.ts:
//   npm run site [-- <out dir>]          (default dist/site)
// English pages are `<page>.html`, Hungarian ones `<page>-hu.html`; each links to the other
// language. The Pages workflow builds the web preview and then this site into `dist/site`, so the
// app's links (`src/platform/links.ts`) resolve to https://danielarpadfalvi.github.io/Blastyard/site/.
// The support address comes from the env `SUPPORT_EMAIL` (repository variable); without it the
// pages point to the store page's developer contact. No external assets: one inline stylesheet.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTACT_FALLBACK,
  NAV,
  PAGES,
  UPDATED,
  UPDATED_LABEL,
  type PageId,
  type SiteLang,
} from './siteContent';

export const PAGE_IDS: readonly PageId[] = ['index', 'privacy', 'terms', 'support'];
export const LANGS: readonly SiteLang[] = ['en', 'hu'];

export function fileName(page: PageId, lang: SiteLang): string {
  return lang === 'en' ? `${page}.html` : `${page}-hu.html`;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapes `text`, turns bare https URLs into links and `{email}` into the contact. */
function inline(text: string, lang: SiteLang, email: string | null): string {
  const contact = email
    ? `<a href="mailto:${esc(email)}">${esc(email)}</a>`
    : esc(CONTACT_FALLBACK[lang]);
  return esc(text)
    .replace(/https:\/\/[^\s<]+[^\s<.,)]/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\{email\}/g, contact);
}

function paragraph(p: string, lang: SiteLang, email: string | null): string {
  if (p.startsWith('- ')) {
    const items = p.split('\n').map((l) => `<li>${inline(l.replace(/^- /, ''), lang, email)}</li>`);
    return `<ul>${items.join('')}</ul>`;
  }
  return `<p>${inline(p, lang, email)}</p>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f3ea;--fg:#2b2118;--card:#fffdf6;--accent:#2f7d32;--muted:#6b5f52}
@media (prefers-color-scheme:dark){:root{--bg:#0b0a14;--fg:#efe9dc;--card:#17151f;--accent:#8fe388;--muted:#b3a99a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:1.2rem 1rem 3rem}
nav{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center;margin-bottom:1.2rem}
nav a{color:var(--accent);font-weight:700;text-decoration:none}nav a[aria-current]{text-decoration:underline}
nav .lang{margin-left:auto}
h1{font-size:1.9rem;margin:.2rem 0 .6rem}h2{font-size:1.2rem;margin:1.6rem 0 .4rem}
.intro{font-size:1.08rem}.card{background:var(--card);border-radius:.8rem;padding:.2rem 1.1rem .6rem;margin-top:1rem}
.updated{color:var(--muted);font-size:.9rem}a{color:var(--accent);overflow-wrap:anywhere}
`;

export function renderPage(page: PageId, lang: SiteLang, email: string | null): string {
  const text = PAGES[lang][page];
  const other: SiteLang = lang === 'en' ? 'hu' : 'en';
  const nav = PAGE_IDS.map((id) => {
    const current = id === page ? ' aria-current="page"' : '';
    return `<a href="${fileName(id, lang)}"${current}>${esc(NAV[lang][id])}</a>`;
  }).join('');
  const sections = text.sections
    .map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((p) => paragraph(p, lang, email)).join('')}`)
    .join('');
  const updated =
    page === 'index' ? '' : `<p class="updated">${UPDATED_LABEL[lang]}: ${UPDATED}</p>`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(text.title)}${page === 'index' ? '' : ' – Blastyard'}</title>
<link rel="icon" href="../favicon.png">
<style>${STYLE.trim()}</style>
</head>
<body>
<main>
<nav>${nav}<a class="lang" href="${fileName(page, other)}" hreflang="${other}">${other === 'hu' ? 'Magyar' : 'English'}</a></nav>
<h1>${esc(text.title)}</h1>
<p class="intro">${inline(text.intro, lang, email)}</p>
<div class="card">${sections}</div>
${updated}
</main>
</body>
</html>
`;
}

/** Every page of the site: file name → HTML. */
export function renderSite(email: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const lang of LANGS) {
    for (const page of PAGE_IDS) out.set(fileName(page, lang), renderPage(page, lang, email));
  }
  return out;
}

export function main(args: string[] = []): number {
  const dir = args[0] ?? join('dist', 'site');
  const email = process.env.SUPPORT_EMAIL?.trim() || null;
  mkdirSync(dir, { recursive: true });
  const pages = renderSite(email);
  for (const [name, html] of pages) writeFileSync(join(dir, name), html);
  console.log(`site: ${pages.size} pages → ${dir}${email ? '' : ' (no SUPPORT_EMAIL)'}`);
  return 0;
}
