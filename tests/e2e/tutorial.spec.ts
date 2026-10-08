import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { SOLUTIONS } from '../../src/content/challenges/solutions';
import { game } from './touch';

/**
 * T5.4 tutorial through the real UI: the five steps played from the reference solution (scripted
 * seat-0 input), a lost step that starts over at the same step, skipping, and a first-time tip
 * (sudden death) that shows once and stays shown after a restart. Screenshots go to
 * `$BLASTYARD_SHOTS` (default `test-results/tutorial`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'tutorial');

test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 120_000 });

async function open(page: Page, lang = 'en'): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&game&clock=manual&lang=${lang}`);
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
const ticksOf = (log: number[]) => log.reduce((n, v, i) => (i % 2 === 1 ? n + v : n), 0);

test('the tutorial plays through all five steps and is remembered as done', async ({ page }) => {
  const errors = await open(page);
  const start = page.getByTestId('start-tutorial');
  await expect(start).toHaveAttribute('data-done', 'false');
  await start.click();
  await expect(page.getByTestId('tutorial-hint')).toHaveAttribute('data-step', '1');
  await shot(page, 'tutorial-step1.png');
  const sol = SOLUTIONS['tutorial']!;
  for (let k = 0; k < 5; k++) {
    await expect(page.getByTestId('tutorial-hint')).toHaveAttribute('data-step', String(k + 1));
    await play(page, sol.logs[k]!);
    if (k === 3) await shot(page, 'tutorial-step4.png');
    if (k < 4) await game.advance(page, ticksOf(sol.logs[k]!) + 70);
  }
  await page.evaluate(() => window.__blastyardGame!.advanceUntilChallengeOver(20_000));
  await expect(page.getByTestId('tutorial-done')).toBeVisible();
  await shot(page, 'tutorial-done.png');
  expect(await page.evaluate(() => window.__blastyardGame!.tips().tutorialDone)).toBe(true);

  await page.getByTestId('tutorial-menu').click();
  await page.reload();
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-tutorial')).toHaveAttribute('data-done', 'true');
  expect(errors).toEqual([]);
});

test('a lost step starts over at the same step; Skip leaves and counts as done', async ({
  page,
}) => {
  await open(page);
  // Step 2: pop and stand still in the blast.
  await page.evaluate(() => window.__blastyardGame!.startTutorial(1));
  await expect(page.getByTestId('tutorial-hint')).toHaveAttribute('data-step', '2');
  await expect(page.getByTestId('tutorial-retry')).toHaveCount(0);
  await play(page, [0, 182, 0x40, 1, 0, 600]);
  // The blast (fuse 150), the loss beat (90 ticks), then the same step again.
  await game.advance(page, 600);
  await expect(page.getByTestId('tutorial-hint')).toHaveAttribute('data-step', '2');
  await expect(page.getByTestId('tutorial-retry')).toBeVisible();
  expect(await page.evaluate(() => window.__blastyardGame!.screen())).toBe('playing');
  await shot(page, 'tutorial-retry.png');

  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__blastyardGame!.tips().tutorialDone)).toBe(true);
  await expect(page.getByTestId('start-tutorial')).toHaveAttribute('data-done', 'true');
});

test('the sudden-death tip shows once and stays shown after a restart', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-faceoff').click();
  // Nobody moves: the 120 s clock runs out and the spiral starts.
  await game.advance(page, 180 + 120 * 60 + 5);
  await expect(page.getByTestId('tip-banner')).toHaveAttribute('data-tip', 'suddenDeath');
  await shot(page, 'tip-sudden-death.png');
  expect(await page.evaluate(() => window.__blastyardGame!.tips().shown)).toEqual(['suddenDeath']);
  // It goes away by itself after 3 s.
  await expect(page.getByTestId('tip-banner')).toHaveCount(0, { timeout: 6000 });

  // Restart: the tip is remembered as shown (TipsStore never offers it again – unit-tested).
  await page.reload();
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  expect(await page.evaluate(() => window.__blastyardGame!.tips().shown)).toEqual(['suddenDeath']);
  expect(await page.evaluate(() => window.__blastyardGame!.tip())).toBeNull();
});

test('Hungarian tutorial hint fits', async ({ page }) => {
  await open(page, 'hu');
  await page.evaluate(() => window.__blastyardGame!.startTutorial(1));
  await expect(page.getByTestId('tutorial-skip')).toHaveText('Kihagyás');
  await expect(page.getByTestId('tutorial-hint')).toContainText('bújj el');
  await shot(page, 'tutorial-step2-hu.png');
});

test.describe('on a phone-sized screen', () => {
  test.use({ viewport: { width: 800, height: 360 } });

  test('the step card fits in the strip and leaves the arena free', async ({ page }) => {
    await open(page, 'hu');
    await page.evaluate(() => window.__blastyardGame!.startTutorial(0));
    const hint = await page.getByTestId('tutorial-hint').boundingBox();
    const layout = await page.evaluate(() => window.__blastyardGame!.layout());
    expect(hint).not.toBeNull();
    expect(hint!.x + hint!.width).toBeLessThanOrEqual(layout.arena.x);
    expect(hint!.y + hint!.height).toBeLessThanOrEqual(360);
    await shot(page, 'tutorial-step1-phone-hu.png');
  });
});
