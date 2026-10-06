import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
// Type-only: brings the `window.__blastyard` declaration into scope.
import type {} from '../../src/game/arenaDevView';

/**
 * T2.1 renderer: the dev/test arena view (`?test`) at the acceptance screen sizes (1× DPR).
 * Screenshots go to `$BLASTYARD_SHOTS` when set (Playwright wipes `test-results` every run),
 * otherwise to `test-results/render/`.
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'render');
/** Countdown (180) + first blast of the demo script: flames, broken crates, revealed pickups. */
const BLAST_TICK = 392;
/** Second demo cycle: pops ticking with their fuse rings. */
const POP_TICK = 560;

const SCREENS = [
  { width: 2400, height: 1080 },
  { width: 1600, height: 720 },
  { width: 2048, height: 1536 },
] as const;

async function openArena(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&${query}`);
  await page.waitForFunction(() => window.__blastyard?.ready === true);
  return errors;
}

for (const screen of SCREENS) {
  test.describe(`arena view ${screen.width}×${screen.height}`, () => {
    test.use({ viewport: screen, deviceScaleFactor: 1 });

    test('full arena on screen, ≥ 38 mm strips, sprites match the state', async ({ page }) => {
      const errors = await openArena(page, `arena=garden&seed=1&pause&tick=${BLAST_TICK}`);
      const layout = await page.evaluate(() => window.__blastyard!.layout());
      expect(layout.width).toBe(screen.width);
      expect(layout.height).toBe(screen.height);
      const a = layout.arena;
      expect(a.w).toBe(a.h);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(screen.width);
      expect(a.y + a.h).toBeLessThanOrEqual(screen.height);
      expect(layout.stripMm).toBeGreaterThanOrEqual(38);

      const { stats, counts, tick } = await page.evaluate(() => ({
        stats: window.__blastyard!.renderStats(),
        counts: window.__blastyard!.stateCounts(),
        tick: window.__blastyard!.tick(),
      }));
      expect(tick).toBe(BLAST_TICK);
      expect(stats.tick).toBe(BLAST_TICK);
      expect(stats).toEqual({ ...counts, tick: BLAST_TICK });
      expect(counts.puffs).toBe(4);
      expect(counts.pillars).toBe(25);
      expect(counts.flames).toBeGreaterThan(0);

      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({
        path: join(SHOT_DIR, `arena-${screen.width}x${screen.height}-blast.png`),
      });

      await page.evaluate((n) => window.__blastyard!.advance(n), POP_TICK - BLAST_TICK);
      const later = await page.evaluate(() => ({
        stats: window.__blastyard!.renderStats(),
        counts: window.__blastyard!.stateCounts(),
      }));
      expect(later.stats).toEqual({ ...later.counts, tick: POP_TICK });
      expect(later.counts.pops).toBeGreaterThan(0);
      await page.screenshot({
        path: join(SHOT_DIR, `arena-${screen.width}x${screen.height}-pops.png`),
      });
      expect(errors).toEqual([]);
    });
  });
}

test('the arena view runs in real time and is deterministic per seed', async ({ page }) => {
  const errors = await openArena(page, 'arena=crossroads&seed=5');
  await expect.poll(() => page.evaluate(() => window.__blastyard!.tick())).toBeGreaterThan(30);
  // Same seed + same ticks ⇒ same state hash, whatever the frame timing was.
  await page.evaluate(() => window.__blastyard!.pause());
  const first = await page.evaluate(() => [window.__blastyard!.tick(), window.__blastyard!.hash()]);
  const page2 = await page.context().newPage();
  await openArena(page2, `arena=crossroads&seed=5&pause&tick=${first[0]}`);
  const second = await page2.evaluate(() => window.__blastyard!.hash());
  expect(second).toBe(first[1]);
  expect(errors).toEqual([]);
});

test('without ?test there is no test hook', async ({ page }) => {
  await page.goto('/?view=arena');
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  expect(await page.evaluate(() => window.__blastyard === undefined)).toBe(true);
});
