import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import { game } from './touch';

/**
 * T6.2 save & progression through the real UI: the old loose save keys are folded into the
 * versioned document on the first start, looks are picked per seat (milestone and Blastyard+
 * locks) and survive a restart, a played match lands in the lifetime stats and earns trophies.
 * Screenshots go to `$BLASTYARD_SHOTS` (default `test-results/customize`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'customize');

test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 120_000 });

async function open(page: Page, extra = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&game&clock=manual&lang=en${extra}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  return errors;
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

test('the first start folds the old save keys into the versioned document', async ({ page }) => {
  await page.goto('/?test&game&clock=manual&lang=en');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('blastyard.challenges.v1', JSON.stringify({ 'w1-01': 3, 'w1-02': 2 }));
    localStorage.setItem('blastyard.tips.v1', JSON.stringify({ tutorialDone: true, shown: [] }));
  });
  await open(page);
  const doc = await page.evaluate(() => ({
    save: localStorage.getItem('blastyard.save'),
    legacy: localStorage.getItem('blastyard.challenges.v1'),
  }));
  expect(doc.legacy).toBeNull();
  expect(JSON.parse(doc.save!)).toMatchObject({ version: 1 });
  await expect(page.getByTestId('start-tutorial')).toHaveAttribute('data-done', 'true');
  await page.getByTestId('start-challenges').click();
  await expect(page.getByTestId('map-total')).toContainText('5/108');
});

test('looks per seat with milestone and Plus locks; stats and trophies from a match', async ({
  page,
}) => {
  const errors = await open(page, '&wins=1&seed=3');
  await page.getByTestId('start-customize').click();
  await expect(page.getByTestId('customize-screen')).toBeVisible();
  await expect(page.getByTestId('item-bunny')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('item-sprout')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('item-sprout')).toContainText('Play 5 matches (0/5)');
  await expect(page.getByTestId('item-cat')).toContainText('Blastyard+');
  await page.getByTestId('item-duck').click();
  await page.getByTestId('look-category-hat').click();
  await page.getByTestId('item-cap').click();
  await page.getByTestId('look-category-trail').click();
  await page.getByTestId('item-dust').click();
  await page.getByTestId('look-seat-1').click();
  await page.getByTestId('look-category-hat').click();
  await expect(page.getByTestId('item-cap')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('item-party').click();
  await shot(page, 'customize-looks.png');
  await page.getByTestId('customize-tab-trophies').click();
  await expect(page.getByTestId('trophy-count')).toContainText('0/20');
  await expect(page.getByTestId('stat-matches')).toHaveText('0');
  await page.getByTestId('customize-back').click();

  const looks = await page.evaluate(() => window.__blastyardGame!.wornLooks());
  expect(looks[0]).toMatchObject({ puff: 'duck', hat: 'cap', trail: 'dust' });
  expect(looks[1]).toMatchObject({ hat: 'party' });

  // A match lands in the stats and earns the first trophy.
  await page.getByTestId('start-solo').click();
  await game.until(page, Phase.MATCH_OVER, 20_000);
  await expect(page.getByTestId('result-screen')).toBeVisible();
  expect((await page.evaluate(() => window.__blastyardGame!.stats())).matches).toBe(1);
  await page.getByTestId('to-menu').click();

  // Restart: looks, stats and trophies are still there.
  await page.reload();
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  expect((await page.evaluate(() => window.__blastyardGame!.wornLooks()))[0]).toMatchObject({
    puff: 'duck',
  });
  await page.getByTestId('start-customize').click();
  await page.getByTestId('customize-tab-trophies').click();
  await expect(page.getByTestId('stat-matches')).toHaveText('1');
  await expect(page.getByTestId('trophy-firstMatch')).toHaveAttribute('data-earned', 'true');
  await shot(page, 'customize-trophies.png');
  expect(errors).toEqual([]);
});

test('Blastyard+ opens the Plus items', async ({ page }) => {
  await open(page, '&plus');
  await page.getByTestId('start-customize').click();
  await expect(page.getByTestId('item-cat')).toHaveAttribute('data-locked', 'false');
  await page.getByTestId('item-cat').click();
  expect((await page.evaluate(() => window.__blastyardGame!.wornLooks()))[0]!.puff).toBe('cat');
});
