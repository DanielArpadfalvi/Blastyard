import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * T5.3 daily challenge through the real UI: the date (fixed with `?date`) picks the challenge,
 * the first attempt is the official one, a win starts a streak that survives a reload (app
 * restart), the next day keeps it alive and a missed day resets it. The run is the bot's own
 * winning input log, fed in as scripted seat-0 input. Screenshots go to `$BLASTYARD_SHOTS`
 * (default `test-results/daily`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'daily');

test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 120_000 });

async function open(page: Page, date: string, lang = 'en'): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&game&clock=manual&lang=${lang}&date=${date}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  return errors;
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openDaily(page: Page): Promise<void> {
  await page.getByTestId('start-daily').click();
  await expect(page.getByTestId('daily-screen')).toBeVisible();
  await expect(page.getByTestId('daily-card')).toBeVisible({ timeout: 30_000 });
}

test('same date, same challenge; the official win starts a streak that survives a restart', async ({
  page,
}) => {
  const errors = await open(page, '2026-10-08');
  await openDaily(page);
  const first = await page.evaluate(() => window.__blastyardGame!.prepareDaily());
  expect(first.levelId).toBe('daily-2026-10-08');
  await expect(page.getByTestId('daily-card')).toHaveAttribute('data-level', first.levelId);
  await expect(page.getByTestId('daily-modifier')).toHaveAttribute('data-modifier', first.modifier);
  await expect(page.getByTestId('daily-play')).toHaveAttribute('data-official', 'true');
  await expect(page.getByTestId('daily-streak')).toHaveAttribute('data-streak', '0');
  await shot(page, 'daily-card.png');

  // The official attempt, played with the bot's winning inputs.
  const log = await page.evaluate(() => window.__blastyardGame!.dailySolution());
  await page.getByTestId('daily-play').click();
  await expect.poll(() => page.evaluate(() => window.__blastyardGame!.screen())).toBe('playing');
  await expect(page.getByTestId('challenge-bar')).toBeVisible();
  await page.evaluate((l) => window.__blastyardGame!.playScript(l), log);
  await page.evaluate(() => window.__blastyardGame!.advanceUntilChallengeOver(20_000));
  await expect(page.getByTestId('challenge-result')).toBeVisible();
  await expect(page.getByTestId('challenge-result-title')).toHaveText('Daily complete!');
  await expect(page.getByTestId('daily-result-badge')).toHaveAttribute('data-official', 'true');
  await expect(page.getByTestId('daily-new-best')).toBeVisible();
  await expect(page.getByTestId('daily-streak')).toHaveAttribute('data-streak', '1');
  await expect(page.getByTestId('challenge-next')).toHaveCount(0);
  await shot(page, 'daily-result.png');

  // Back on the card: the official result is in, further attempts are practice.
  await page.getByTestId('challenge-to-map').click();
  await expect(page.getByTestId('daily-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('daily-play')).toHaveAttribute('data-official', 'false');
  await expect(page.getByTestId('daily-official')).toContainText('Official:');
  await expect(page.getByTestId('daily-best')).toBeVisible();

  // A practice attempt, abandoned from the pause menu, changes nothing official.
  await page.getByTestId('daily-play').click();
  await expect.poll(() => page.evaluate(() => window.__blastyardGame!.screen())).toBe('playing');
  await page.evaluate(() => window.__blastyardGame!.setPaused(true));
  await page.getByTestId('pause-leave').click();
  await expect(page.getByTestId('daily-card')).toBeVisible({ timeout: 30_000 });
  const view = await page.evaluate(() => window.__blastyardGame!.dailyView());
  expect(view).toMatchObject({ attempts: 2, streak: 1, wonToday: true });
  expect(view.official).toMatchObject({ won: true });

  // Restart: same date ⇒ same challenge, and the streak is still there.
  await page.reload();
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-daily')).toContainText('Daily streak: 1');
  const again = await page.evaluate(() => window.__blastyardGame!.prepareDaily());
  expect(again).toEqual(first);
  expect(errors).toEqual([]);
});

test('the streak lives on the next day and resets after a missed day', async ({ page }) => {
  await open(page, '2026-10-08');
  await page.evaluate(() => window.__blastyardGame!.prepareDaily());
  const log = await page.evaluate(() => window.__blastyardGame!.dailySolution());
  await page.evaluate(() => window.__blastyardGame!.startDaily());
  await page.evaluate((l) => window.__blastyardGame!.playScript(l), log);
  await page.evaluate(() => window.__blastyardGame!.advanceUntilChallengeOver(20_000));
  await expect(page.getByTestId('daily-streak')).toHaveAttribute('data-streak', '1');

  // The next day: a different challenge, the streak is alive until it is played.
  await open(page, '2026-10-09');
  await openDaily(page);
  await expect(page.getByTestId('daily-card')).toHaveAttribute('data-level', 'daily-2026-10-09');
  await expect(page.getByTestId('daily-play')).toHaveAttribute('data-official', 'true');
  await expect(page.getByTestId('daily-streak')).toHaveAttribute('data-streak', '1');

  // Two days later without playing: back to zero.
  await open(page, '2026-10-11');
  await expect(page.getByTestId('start-daily')).not.toContainText('Streak');
  await openDaily(page);
  await expect(page.getByTestId('daily-streak')).toHaveAttribute('data-streak', '0');
});

test('Hungarian daily card fits', async ({ page }) => {
  await open(page, '2026-10-12', 'hu');
  await openDaily(page);
  await expect(page.getByTestId('daily-play')).toContainText('hivatalos');
  await shot(page, 'daily-card-hu.png');
});
