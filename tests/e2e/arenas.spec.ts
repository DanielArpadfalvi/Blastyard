import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
// Type-only: brings the `window.__blastyard` / `window.__blastyardSheet` declarations into scope.
import type {} from '../../src/game/arenaDevView';
import type {} from '../../src/game/sheetView';
import { ALL_ARENAS } from '../../src/content/arenas';
import { HATS, POP_SKINS, PUFFS, TRAILS } from '../../src/content/cosmetics';

/**
 * T4.3 / T4.4 renderer: every arena draws with its theme and floor-mechanic decals, the power-up
 * visuals show up, and the item sheets list every catalogue entry. Screenshots go to
 * `$BLASTYARD_SHOTS` when set, otherwise `test-results/arenas/`.
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'arenas');
const FLOOR_FX_CHARS = '~^>v<TU=bg';

async function open(page: Page, query: string, ready: () => boolean): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?${query}`);
  await page.waitForFunction(ready);
  return errors;
}

test.describe('arenas', () => {
  test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });

  for (const arena of ALL_ARENAS) {
    test(`${arena.id}: themed tiles and mechanic decals match the layout`, async ({ page }) => {
      const errors = await open(
        page,
        `test&arena=${arena.id}&seed=3&pause&tick=200`,
        () => window.__blastyard?.ready === true,
      );
      const decals = arena.rows
        .join('')
        .split('')
        .filter((c) => FLOOR_FX_CHARS.includes(c)).length;
      const info = await page.evaluate(() => ({
        mech: window.__blastyard!.mechanics(),
        stats: window.__blastyard!.renderStats(),
        counts: window.__blastyard!.stateCounts(),
      }));
      expect(info.mech.decals).toBe(decals);
      expect(info.mech.mech !== 0).toBe(decals > 0);
      expect(info.stats).toEqual({ ...info.counts, tick: info.stats.tick });
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(SHOT_DIR, `arena-${arena.id}.png`) });
      expect(errors).toEqual([]);
    });
  }

  test('power-up visuals: shield bubble, Jinx curse, kicked pop sliding, tossed pop in flight', async ({
    page,
  }) => {
    const errors = await open(
      page,
      'test&arena=garden&scene=powers&seed=2&pause&tick=4',
      () => window.__blastyard?.ready === true,
    );
    const early = await page.evaluate(() => window.__blastyard!.powerStats());
    expect(early.shields).toBe(1);
    expect(early.curses).toBe(1);
    expect(early.sliding).toBeGreaterThanOrEqual(1);
    expect(early.flying).toBeGreaterThanOrEqual(1);
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(SHOT_DIR, 'powers-in-flight.png') });
    // The flight is over after about 22 ticks.
    await page.evaluate(() => window.__blastyard!.advance(30));
    const later = await page.evaluate(() => window.__blastyard!.powerStats());
    expect(later.flying).toBe(0);
    expect(errors).toEqual([]);
  });

  test('cosmetics in play: look=… with hat and trail runs without errors', async ({ page }) => {
    const errors = await open(
      page,
      'test&arena=rink&seed=5&pause&tick=420&look=cat.crown.gold.rainbow,bat.wizard.galaxy.stars,owl.halo.frost.sparkle,jelly.laurel.night.bubbles',
      () => window.__blastyard?.ready === true,
    );
    await page.evaluate(() => window.__blastyard!.advance(120));
    expect(errors).toEqual([]);
  });
});

const PAGES: ReadonlyArray<readonly [string, number]> = [
  ['seats', 4],
  ['puffs', PUFFS.length],
  ['hats', HATS.length],
  ['pops', POP_SKINS.length],
  ['trails', TRAILS.length],
  ['themes', 12],
  ['powers', 21],
];

for (const size of [
  { width: 412, height: 915 },
  { width: 360, height: 640 },
]) {
  test.describe(`item sheets ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, deviceScaleFactor: 1 });
    for (const [name, items] of PAGES) {
      test(`${name}: ${items} items`, async ({ page }) => {
        const errors = await open(
          page,
          `view=sheet&page=${name}`,
          () => window.__blastyardSheet?.ready === true,
        );
        const hook = await page.evaluate(() => window.__blastyardSheet!);
        expect(hook.page).toBe(name);
        expect(hook.items).toBe(items);
        mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({
          path: join(SHOT_DIR, `sheet-${name}-${size.width}x${size.height}.png`),
        });
        expect(errors).toEqual([]);
      });
    }

    test('seats stay distinguishable in grayscale (badge shape + number)', async ({ page }) => {
      const errors = await open(
        page,
        'view=sheet&page=seats&gray',
        () => window.__blastyardSheet?.ready === true,
      );
      const hook = await page.evaluate(() => window.__blastyardSheet!);
      expect(hook.gray).toBe(true);
      const filter = await page.evaluate(
        () => getComputedStyle(document.querySelector('canvas')!).filter,
      );
      expect(filter).toContain('grayscale');
      await page.screenshot({
        path: join(SHOT_DIR, `sheet-seats-gray-${size.width}x${size.height}.png`),
      });
      expect(errors).toEqual([]);
    });
  });
}
