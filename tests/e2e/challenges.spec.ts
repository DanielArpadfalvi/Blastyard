import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { SOLUTIONS } from '../../src/content/challenges/solutions';
import { TUNING } from '../../src/content/challenges/tuning';
import { game } from './touch';

/**
 * T5.2 challenges through the real UI and the real session: the map with its locks, playing a
 * level from its reference solution (fed in as scripted seat-0 input), the star result, the
 * unlock of the next level, a failed attempt, a gauntlet swapping stages, and the monsters / flag
 * on screen. Screenshots go to `$BLASTYARD_SHOTS` (default `test-results/challenges`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'challenges');

test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 90_000 });

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

const play = (page: Page, log: number[]) =>
  page.evaluate((l) => window.__blastyardGame!.playScript(l), log);
const untilOver = (page: Page, max: number) =>
  page.evaluate((m) => window.__blastyardGame!.advanceUntilChallengeOver(m), max);

test('the map shows locks: world 1 opens level by level, worlds 2 and 3 need Blastyard+', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('start-challenges').click();
  await expect(page.getByTestId('challenge-map')).toBeVisible();
  await expect(page.getByTestId('level-w1-01')).toHaveAttribute('data-lock', 'open');
  await expect(page.getByTestId('level-w1-02')).toHaveAttribute('data-lock', 'locked-progress');
  await expect(page.getByTestId('world-lock-2')).toBeVisible();
  await expect(page.getByTestId('world-lock-3')).toBeVisible();
  await page.getByTestId('world-tab-2').click();
  await expect(page.getByTestId('level-w2-01')).toHaveAttribute('data-lock', 'locked-plus');
  await page.getByTestId('level-w2-01').click();
  await expect(page.getByTestId('level-lock-hint')).toBeVisible();
  await expect(page.getByTestId('challenge-play')).toHaveCount(0);
  await shot(page, 'map-world2-locked.png');
  // Owning Blastyard+ (mock) opens the whole world at once.
  await page.evaluate(() => window.__blastyardGame!.setPlus(true));
  await expect(page.getByTestId('level-w2-12')).toHaveAttribute('data-lock', 'open');
  await expect(page.getByTestId('world-lock-2')).toHaveCount(0);
  await page.getByTestId('level-w2-05').click();
  await expect(page.getByTestId('challenge-play')).toBeVisible();
});

test('play a level from its reference solution: 3 stars, next level unlocks', async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId('start-challenges').click();
  await page
    .getByTestId('level-w1-03')
    .click()
    .catch(() => undefined);
  // Level 3 is still locked: the card says so and Play is absent.
  await expect(page.getByTestId('challenge-play')).toHaveCount(0);
  await page.evaluate(() => {
    window.__blastyardGame!.recordStars('w1-01', 1);
    window.__blastyardGame!.recordStars('w1-02', 1);
  });
  await page.getByTestId('level-w1-03').click();
  await shot(page, 'map-level-card.png');
  await page.getByTestId('challenge-play').click();
  await expect(page.getByTestId('challenge-bar')).toBeVisible();
  expect(await page.evaluate(() => window.__blastyardGame!.mode())).toBe('challenge');
  await play(page, SOLUTIONS['w1-03']!.logs[0]!);
  await untilOver(page, 6000);
  await expect(page.getByTestId('challenge-result')).toBeVisible();
  await expect(page.getByTestId('result-stars')).toHaveAttribute('data-stars', '3');
  await shot(page, 'challenge-result.png');
  await page.getByTestId('challenge-to-map').click();
  await expect(page.getByTestId('challenge-map')).toBeVisible();
  await expect(page.getByTestId('level-w1-03')).toHaveAttribute('data-stars', '3');
  await expect(page.getByTestId('level-w1-04')).toHaveAttribute('data-lock', 'open');
  expect(errors).toEqual([]);
});

test('a failed attempt shows why, awards nothing and can be retried', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__blastyardGame!.startChallenge('w1-01'));
  await expect(page.getByTestId('challenge-bar')).toBeVisible();
  // Standing still: the 120 s clock runs out.
  await untilOver(page, 10_000);
  await expect(page.getByTestId('challenge-result-title')).toHaveText('Out of time!');
  await expect(page.getByTestId('result-stars')).toHaveCount(0);
  await page.getByTestId('challenge-retry').click();
  await expect(page.getByTestId('challenge-bar')).toBeVisible();
  expect(await game.tick(page)).toBeLessThan(10);
});

test('monsters and the flag: reference solutions win live (snail, hound, hopper, flag)', async ({
  page,
}) => {
  await open(page);
  // Earlier levels count as played, so the ones under test are unlocked.
  await page.evaluate(() => {
    for (const id of ['w1-03', 'w1-08', 'w1-10']) window.__blastyardGame!.recordStars(id, 1);
  });
  for (const id of ['w1-04', 'w1-05', 'w1-09', 'w1-11']) {
    await page.evaluate((i) => window.__blastyardGame!.startChallenge(i), id);
    await expect(page.getByTestId('challenge-bar')).toBeVisible();
    if (id === 'w1-09') {
      // Mid-level frame with the monsters on the field.
      await game.advance(page, 400);
      await shot(page, 'monsters.png');
      await page.evaluate((i) => window.__blastyardGame!.startChallenge(i), id);
    }
    await play(page, SOLUTIONS[id]!.logs[0]!);
    await untilOver(page, 12_000);
    await expect(page.getByTestId('challenge-result-title')).toHaveText('Level complete!');
    const stars = Number(await page.getByTestId('result-stars').getAttribute('data-stars'));
    expect(stars).toBe(3);
    await page.getByTestId('challenge-to-map').click();
    await page.getByTestId('map-back').click();
  }
});

test('a gauntlet swaps to the next stage and keeps the star count', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__blastyardGame!.recordStars('w1-11', 1));
  await page.evaluate(() => window.__blastyardGame!.startChallenge('w1-12'));
  await expect(page.getByTestId('challenge-stage')).toHaveText('Stage 1/3');
  const sol = SOLUTIONS['w1-12']!;
  for (let k = 0; k < 3; k++) {
    await play(page, sol.logs[k]!);
    if (k < 2) {
      const ticks = sol.logs[k]!.reduce((n, v, i) => (i % 2 === 1 ? n + v : n), 0);
      await game.advance(page, ticks + 70);
      await expect(page.getByTestId('challenge-stage')).toHaveText(`Stage ${k + 2}/3`);
    }
  }
  await untilOver(page, 12_000);
  await expect(page.getByTestId('challenge-result-title')).toHaveText('Level complete!');
  expect(TUNING['w1-12']!.seeds).toHaveLength(3);
  await expect(page.getByTestId('result-stars')).toHaveAttribute('data-stars', '3');
});
