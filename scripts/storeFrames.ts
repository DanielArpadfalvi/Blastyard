// Store screenshots (T9.2): deterministic scenes of the real game, framed with an EN / HU caption,
// at every store size.
//   npm run store:frames                       all sizes, both languages → store-frames/
//   npm run store:frames -- --size=play-phone --lang=en --scene=party
//   npm run store:frames -- --verify           renders one frame twice, fails unless identical
// The game runs from a production build (`npm run build` first) under a manual clock with fixed
// seeds, so the same environment reproduces every PNG byte for byte. Captions and frame are HTML
// rendered by the same headless Chromium (no external fonts or images).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { preview } from 'vite';
import type {} from '../src/game/shell';
import type {} from '../src/game/arenaDevView';

export type FrameLang = 'en' | 'hu';

export interface StoreSize {
  readonly id: string;
  /** Output size in pixels (landscape). */
  readonly width: number;
  readonly height: number;
  /** The device the game is rendered as: CSS viewport and pixel ratio. */
  readonly device: { readonly width: number; readonly height: number; readonly dpr: number };
}

/** Landscape sizes the stores take (Apple: 6.9" / 6.5" iPhone, 13" iPad; Play: phone, tablet). */
export const SIZES: readonly StoreSize[] = [
  { id: 'iphone-69', width: 2868, height: 1320, device: { width: 956, height: 440, dpr: 3 } },
  { id: 'iphone-65', width: 2778, height: 1284, device: { width: 926, height: 428, dpr: 3 } },
  { id: 'ipad-13', width: 2752, height: 2064, device: { width: 1376, height: 1032, dpr: 2 } },
  { id: 'play-phone', width: 1920, height: 1080, device: { width: 960, height: 540, dpr: 2 } },
  { id: 'play-tablet', width: 2560, height: 1600, device: { width: 1280, height: 800, dpr: 2 } },
];

export const SCENE_IDS = ['party', 'chain', 'challenges', 'lobby', 'customize'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const CAPTIONS: Record<FrameLang, Record<SceneId, readonly [string, string]>> = {
  en: {
    party: ['One device. Four players.', 'Lay it flat – everyone takes an edge'],
    chain: ['Set off chain reactions', 'Pops, crates, power-ups – and a Jinx to pass on'],
    challenges: ['Play solo too', '36 challenges with stars, plus a new daily challenge'],
    lobby: ['Everyone gets ready', 'Try your controls in the warm-up lobby'],
    customize: ['Make your Puff yours', 'Puffs, hats, pop skins and trails – earned by playing'],
  },
  hu: {
    party: ['Egy eszköz. Négy játékos.', 'Tedd le az asztalra – mindenki fog egy szélt'],
    chain: ['Láncreakciók', 'Pukkancsok, ládák, erősítők – és egy továbbadható Átok'],
    challenges: ['Egyedül is', '36 kihívás csillagokkal, és minden nap új napi kihívás'],
    lobby: ['Mindenki felkészül', 'A bemelegítő lobbiban kipróbálod a vezérlést'],
    customize: ['Legyen a te Puffod', 'Puffok, kalapok, pukkancs-skinek és nyomok – játékkal'],
  },
};

async function gamePage(page: Page, base: string, lang: FrameLang, extra: string): Promise<void> {
  await page.goto(`${base}/?test&game&clock=manual&lang=${lang}${extra}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
}

const advance = (page: Page, ticks: number): Promise<void> =>
  page.evaluate((t) => window.__blastyardGame!.advance(t), ticks);

/** Advances one tick at a time until a blast flashes (or `max` ticks). */
async function untilFlash(page: Page, max: number, game = true): Promise<void> {
  for (let i = 0; i < max; i++) {
    const fx = await page.evaluate((g) => {
      const h = g ? window.__blastyardGame! : window.__blastyard!;
      h.advance(1);
      return h.fx();
    }, game);
    if (fx.flash > 0 && fx.particles > 20) return;
  }
}

/** Each scene leaves the page showing what the screenshot should capture. */
const SCENES: Record<SceneId, (page: Page, base: string, lang: FrameLang) => Promise<void>> = {
  async party(page, base, lang) {
    await gamePage(page, base, lang, '&seed=11&wins=3&spike&bots=3&plus');
    await page.getByTestId('start-corners').click();
    await page.getByTestId('hud').waitFor();
    await advance(page, 900);
    await untilFlash(page, 900);
    await advance(page, 4);
  },
  async chain(page, base, lang) {
    await page.goto(`${base}/?test&arena=garden&seed=5&scene=chain&pause&lang=${lang}`);
    await page.waitForFunction(() => window.__blastyard?.ready === true);
    await untilFlash(page, 60, false);
    await page.evaluate(() => window.__blastyard!.advance(8));
  },
  async challenges(page, base, lang) {
    await gamePage(page, base, lang, '&seed=3');
    const stars: Array<[string, number]> = [
      ['w1-01', 3],
      ['w1-02', 3],
      ['w1-03', 2],
      ['w1-04', 3],
      ['w1-05', 1],
      ['w1-06', 2],
    ];
    await page.evaluate((list) => {
      for (const [id, n] of list) window.__blastyardGame!.recordStars(id, n);
    }, stars);
    await page.getByTestId('start-challenges').click();
    await page.getByTestId('challenge-map').waitFor();
  },
  async lobby(page, base, lang) {
    await gamePage(page, base, lang, '&seed=21&wins=3');
    await page.getByTestId('start-party').click();
    await page.getByTestId('party-layout-corners').click();
    await page.getByTestId('party-seat-2').click();
    await page.getByTestId('party-seat-3').click();
    await page.getByTestId('party-start').click();
    await page.getByTestId('lobby-bar').waitFor();
    await advance(page, 30);
  },
  async customize(page, base, lang) {
    // A played-in save: most milestone items are unlocked, as for a regular player.
    await page.addInitScript(() => {
      const stats = { matches: 24, wins: 12, knockouts: 60, pops: 400, powerUps: 150 };
      localStorage.setItem(
        'blastyard.save',
        JSON.stringify({ version: 1, entries: { 'blastyard.stats.v1': JSON.stringify(stats) } }),
      );
    });
    await gamePage(page, base, lang, '&seed=3&plus');
    await page.getByTestId('start-customize').click();
    await page.getByTestId('customize-screen').waitFor();
    await page.getByTestId('item-cat').click();
    await page.getByTestId('look-category-hat').click();
    await page.getByTestId('item-crown').click();
    await page.evaluate(() => {
      const grid = document.querySelector('.item-grid');
      if (grid) grid.scrollTop = 0;
    });
    // Thumbnails are baked asynchronously.
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.item-cell img')].every(
        (i) => (i as HTMLImageElement).complete,
      ),
    );
  },
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The store frame: caption band above the game screenshot. */
export function frameHtml(
  size: StoreSize,
  caption: readonly [string, string],
  png: Buffer,
): string {
  const band = Math.round(size.height * 0.2);
  const pad = Math.round(size.height * 0.035);
  const shotH = size.height - band - pad;
  const shotW = Math.round((shotH * size.device.width) / size.device.height);
  const title = Math.round(band * 0.36);
  const sub = Math.round(band * 0.2);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden}
body{background:linear-gradient(180deg,#5fbf4a 0%,#2f7d32 55%,#1d4f20 100%);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff}
.cap{height:${band}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
h1{margin:0;font-size:${title}px;font-weight:900;color:#ffd23f;-webkit-text-stroke:${Math.max(2, Math.round(title * 0.06))}px #2b2118;paint-order:stroke fill;letter-spacing:.01em}
p{margin:${Math.round(sub * 0.25)}px 0 0;font-size:${sub}px;font-weight:700;text-shadow:0 ${Math.round(sub * 0.08)}px 0 #2b2118}
.shot{display:block;margin:0 auto;width:${shotW}px;height:${shotH}px;border-radius:${Math.round(shotH * 0.045)}px;border:${Math.round(shotH * 0.012)}px solid #2b2118;box-sizing:border-box;object-fit:cover;box-shadow:0 ${Math.round(pad * 0.4)}px ${pad}px rgba(0,0,0,.35)}
</style></head><body><div class="cap"><h1>${esc(caption[0])}</h1><p>${esc(caption[1])}</p></div>
<img class="shot" src="data:image/png;base64,${png.toString('base64')}"></body></html>`;
}

export async function renderFrame(
  browser: Browser,
  base: string,
  size: StoreSize,
  lang: FrameLang,
  scene: SceneId,
): Promise<Buffer> {
  const ctx = await browser.newContext({
    viewport: { width: size.device.width, height: size.device.height },
    deviceScaleFactor: size.device.dpr,
    hasTouch: true,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await SCENES[scene](page, base, lang);
  // Two animation frames so the last state is on the canvas.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await ctx.close();
  if (errors.length > 0) throw new Error(`${scene}/${size.id}/${lang}: ${errors.join('; ')}`);

  const fctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  const frame = await fctx.newPage();
  await frame.setContent(frameHtml(size, CAPTIONS[lang][scene], shot));
  await frame.waitForFunction(
    () => (document.querySelector('img.shot') as HTMLImageElement).complete,
  );
  const png = await frame.screenshot({ animations: 'disabled' });
  await fctx.close();
  return png;
}

function arg(args: string[], name: string): string | null {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

export async function main(args: string[] = []): Promise<number> {
  if (!existsSync('dist/index.html')) {
    console.error('store-frames: run `npm run build` first');
    return 2;
  }
  const out = arg(args, 'out') ?? 'store-frames';
  const sizes = SIZES.filter((s) => (arg(args, 'size') ?? s.id) === s.id);
  const langs = (['en', 'hu'] as const).filter((l) => (arg(args, 'lang') ?? l) === l);
  const scenes = SCENE_IDS.filter((s) => (arg(args, 'scene') ?? s) === s);
  const verify = args.includes('--verify');

  const server = await preview({
    configFile: false,
    root: process.cwd(),
    logLevel: 'error',
    preview: { port: Number(process.env.FRAMES_PORT ?? 4190), strictPort: true, host: '127.0.0.1' },
  });
  const base = `http://127.0.0.1:${server.config.preview.port}`;
  const fallback = join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers', 'chromium');
  const browser = await chromium.launch(
    existsSync(chromium.executablePath()) || !existsSync(fallback)
      ? {}
      : { executablePath: fallback },
  );
  let code = 0;
  try {
    if (verify) {
      const size = sizes[0] ?? (SIZES[3] as StoreSize);
      const scene = scenes[0] ?? 'party';
      const a = await renderFrame(browser, base, size, langs[0] ?? 'en', scene);
      const b = await renderFrame(browser, base, size, langs[0] ?? 'en', scene);
      const ha = createHash('sha256').update(a).digest('hex');
      const hb = createHash('sha256').update(b).digest('hex');
      console.log(
        `store-frames verify ${scene}/${size.id}: ${ha === hb ? 'identical' : 'DIFFERENT'} ${ha.slice(0, 16)}`,
      );
      code = ha === hb ? 0 : 1;
    } else {
      let n = 0;
      for (const size of sizes) {
        for (const lang of langs) {
          const dir = join(out, lang, size.id);
          mkdirSync(dir, { recursive: true });
          for (const scene of scenes) {
            const png = await renderFrame(browser, base, size, lang, scene);
            writeFileSync(join(dir, `${SCENE_IDS.indexOf(scene) + 1}-${scene}.png`), png);
            n++;
          }
        }
      }
      console.log(`store-frames: ${n} images → ${out}/`);
    }
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.httpServer.close(() => r()));
  }
  return code;
}
