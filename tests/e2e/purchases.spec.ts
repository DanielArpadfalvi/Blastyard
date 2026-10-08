import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import { game } from './touch';

/**
 * T8.1 purchases through the real UI with the web mock store (`?test`): the paywall opens from a
 * locked item or the settings, buys (success, pending, cancelled, failed, no store), restores,
 * the Supporter pack thanks the player, custom rules need Blastyard+, and the one-off Blastyard+
 * card shows after the 5th finished match. Screenshots go to `$BLASTYARD_SHOTS`
 * (default `test-results/purchases`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'purchases');

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
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

async function paywallFromSettings(page: Page): Promise<void> {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-plus').click();
  await expect(page.getByTestId('paywall')).toBeVisible();
}

test('a locked arena opens the paywall; buying unlocks Blastyard+ at once', async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId('start-party').click();
  await page.getByTestId('party-arena').click();
  await expect(page.getByTestId('lock-maze')).toBeVisible();
  await page.getByTestId('arena-maze').click();
  await expect(page.getByTestId('paywall')).toBeVisible();
  await expect(page.getByTestId('paywall-buy')).toHaveText('Get Blastyard+ – $2.99');
  await expect(page.getByTestId('paywall-supporter')).toHaveText('Support – $1.99');
  await expect(page.getByTestId('paywall-terms')).toBeVisible();
  await expect(page.getByTestId('paywall-privacy')).toBeVisible();
  await shot(page, 'paywall-en.png');
  await page.getByTestId('paywall-buy').click();
  await expect(page.getByTestId('paywall-status')).toHaveText('Thank you! Blastyard+ is unlocked.');
  await expect(page.getByTestId('paywall-owned')).toBeVisible();
  expect(await page.evaluate(() => window.__blastyardGame!.hasSupporter())).toBe(false);
  await page.getByTestId('paywall-close').click();
  await expect(page.getByTestId('lock-maze')).toHaveCount(0);
  await page.getByTestId('arena-maze').click();
  await expect(page.getByTestId('arena-maze')).toHaveClass(/arena-on/);
  expect(errors).toEqual([]);
});

test('pending, cancelled and failed purchases unlock nothing until the store confirms', async ({
  page,
}) => {
  const errors = await open(page, '&store=pending');
  await paywallFromSettings(page);
  await page.getByTestId('paywall-buy').click();
  await expect(page.getByTestId('paywall-status')).toContainText('Payment pending');
  await expect(page.getByTestId('paywall-buy')).toBeVisible();
  await shot(page, 'paywall-pending.png');
  // The payment goes through later: the paywall updates by itself.
  await page.evaluate(() => window.__blastyardGame!.completePending());
  await expect(page.getByTestId('paywall-owned')).toBeVisible();
  await page.evaluate(() => window.__blastyardGame!.setPlus(false));

  for (const [outcome, text] of [
    ['cancelled', 'Purchase cancelled. Nothing was charged.'],
    ['failed', 'The purchase did not go through. Please try again later.'],
  ] as const) {
    await page.evaluate((o) => window.__blastyardGame!.setStoreOutcome(o), outcome);
    await page.getByTestId('paywall-close').click();
    await page.getByTestId('settings-plus').click();
    await page.getByTestId('paywall-buy').click();
    await expect(page.getByTestId('paywall-status')).toHaveText(text);
    await expect(page.getByTestId('paywall-buy')).toBeEnabled();
  }
  expect(await page.evaluate(() => window.__blastyardGame!.hasPlus())).toBe(false);
  expect(errors).toEqual([]);
});

test('without a store: no price, no purchase, an explanation', async ({ page }) => {
  await open(page, '&store=none');
  await paywallFromSettings(page);
  await expect(page.getByTestId('paywall-status')).toHaveText(
    'The store is not available right now. Nothing is charged.',
  );
  await expect(page.getByTestId('paywall-buy')).toBeDisabled();
  await page.getByTestId('paywall-restore').click();
  await expect(page.getByTestId('paywall-status')).toHaveText('The store is not available.');
  expect(await page.evaluate(() => window.__blastyardGame!.hasPlus())).toBe(false);
});

test('restore, and the Supporter pack: thanks and its own two items', async ({ page }) => {
  const errors = await open(page, '&plus');
  await paywallFromSettings(page);
  await expect(page.getByTestId('paywall-owned')).toBeVisible();
  await page.getByTestId('paywall-restore').click();
  await expect(page.getByTestId('paywall-status')).toHaveText('Purchases restored.');
  await page.getByTestId('paywall-supporter').click();
  await expect(page.getByTestId('supporter-thanks')).toBeVisible();
  await shot(page, 'supporter-thanks.png');
  await page.getByTestId('thanks-close').click();
  await expect(page.getByTestId('paywall-supporter-owned')).toBeVisible();
  await page.getByTestId('paywall-close').click();
  await page.getByTestId('settings-back').click();

  await page.getByTestId('start-customize').click();
  await page.getByTestId('look-category-hat').click();
  await page.getByTestId('item-goldcrown').click();
  await page.getByTestId('look-category-trail').click();
  await page.getByTestId('item-confetti').click();
  await page.getByTestId('customize-back').click();
  expect((await page.evaluate(() => window.__blastyardGame!.wornLooks()))[0]).toMatchObject({
    hat: 'goldcrown',
    trail: 'confetti',
  });
  expect(errors).toEqual([]);
});

test('locked Supporter / Plus items in Customize open the paywall', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-customize').click();
  await page.getByTestId('look-category-hat').click();
  await expect(page.getByTestId('item-goldcrown')).toContainText('Supporter pack');
  await page.getByTestId('item-goldcrown').click();
  await expect(page.getByTestId('paywall')).toBeVisible();
  await page.getByTestId('paywall-close').click();
  // Milestone items stay plain locks.
  await expect(page.getByTestId('item-tophat')).toBeDisabled();
});

test('custom rules need Blastyard+; with it they are edited and kept', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-party').click();
  await page.getByTestId('party-preset-custom').click();
  await expect(page.getByTestId('paywall')).toBeVisible();
  await page.getByTestId('paywall-buy').click();
  await expect(page.getByTestId('paywall-owned')).toBeVisible();
  await page.getByTestId('paywall-close').click();

  await page.getByTestId('party-preset-custom').click();
  await expect(page.getByTestId('custom-rules')).toBeVisible();
  await page.getByTestId('custom-round-60').click();
  await page.getByTestId('custom-bombs-3').click();
  await page.getByTestId('custom-power-9-0').click();
  await page.getByTestId('custom-ghosts-false').click();
  await shot(page, 'custom-rules.png');
  await page.getByTestId('custom-done').click();
  await expect(page.getByTestId('party-custom-edit')).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await page.evaluate(() => window.__blastyardGame!.setPlus(true));
  await page.getByTestId('start-party').click();
  await expect(page.getByTestId('party-preset-custom')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('party-custom-edit').click();
  await expect(page.getByTestId('custom-round-60')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('custom-bombs-3')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('custom-power-9-0')).toHaveAttribute('aria-checked', 'true');
});

test('the Blastyard+ card shows once, after the 5th finished match', async ({ page }) => {
  await page.goto('/?test&game&clock=manual&lang=en');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'blastyard.save',
      JSON.stringify({
        version: 1,
        entries: { 'blastyard.stats.v1': JSON.stringify({ matches: 4 }) },
      }),
    );
  });
  const errors = await open(page, '&wins=1&seed=3');
  expect((await page.evaluate(() => window.__blastyardGame!.stats())).matches).toBe(4);
  await page.getByTestId('start-solo').click();
  await game.until(page, Phase.MATCH_OVER, 20_000);
  await expect(page.getByTestId('result-screen')).toBeVisible();
  await expect(page.getByTestId('plus-card')).toBeVisible();
  // Non-blocking: the result buttons stay usable.
  await expect(page.getByTestId('play-again')).toBeEnabled();
  await shot(page, 'plus-card.png');
  await page.getByTestId('plus-card-open').click();
  await expect(page.getByTestId('paywall')).toBeVisible();
  await page.getByTestId('paywall-close').click();

  // Once only: the next result has no card.
  await page.getByTestId('play-again').click();
  await game.until(page, Phase.MATCH_OVER, 20_000);
  await expect(page.getByTestId('result-screen')).toBeVisible();
  await expect(page.getByTestId('plus-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});
