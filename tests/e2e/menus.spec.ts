import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import { game } from './touch';

/**
 * T6.1 menus and flow: every screen is reachable and fits (1280×720 and 2048×1536), the back
 * action (Android back button, Escape) walks one step back everywhere, the settings apply and
 * persist, the result screen shows the match stats. Screenshots go to `$BLASTYARD_SHOTS`
 * (default `test-results/menus`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'menus');

test.describe.configure({ timeout: 120_000 });

async function open(page: Page, extra = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&game&clock=manual${extra}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  return errors;
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

const back = (page: Page) => page.evaluate(() => window.__blastyardGame!.back());

/** Every button of `root` lies inside the viewport (after scrolling its card into view). */
async function expectButtonsInside(page: Page, root: Locator): Promise<void> {
  const size = page.viewportSize()!;
  const buttons = root.locator('button');
  const n = await buttons.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    await b.scrollIntoViewIfNeeded();
    const box = await b.boundingBox();
    expect(box, `button ${i}`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 0.5);
  }
  // Nothing sticks out sideways inside the card.
  const overflow = await root.evaluate((el) => {
    const card = el.querySelector('.card') ?? el;
    return card.scrollWidth - card.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of [
  { width: 1280, height: 720 },
  { width: 2048, height: 1536 },
]) {
  test.describe(`${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp, deviceScaleFactor: 1 });

    test('every menu screen fits and back walks one step up', async ({ page }) => {
      const errors = await open(page, '&lang=hu');
      const tag = `${vp.width}x${vp.height}`;
      await expectButtonsInside(page, page.getByTestId('start-screen'));
      await shot(page, `start-${tag}.png`);
      for (const id of [
        'start-quick',
        'start-party',
        'start-challenges',
        'start-daily',
        'start-tutorial',
        'open-settings',
      ]) {
        await expect(page.getByTestId(id)).toBeVisible();
      }
      // Back on the start screen is declined (the platform may leave the app).
      expect(await back(page)).toBe(false);

      const views: Array<[string, string]> = [
        ['start-party', 'party-setup'],
        ['start-challenges', 'challenge-map'],
        ['start-daily', 'daily-screen'],
        ['open-settings', 'settings-screen'],
      ];
      for (const [button, screen] of views) {
        await page.getByTestId(button).click();
        await expect(page.getByTestId(screen)).toBeVisible();
        if (screen === 'daily-screen') {
          await expect(page.getByTestId('daily-card')).toBeVisible({ timeout: 30_000 });
        }
        await expectButtonsInside(page, page.getByTestId(screen));
        await shot(page, `${screen}-${tag}.png`);
        expect(await back(page)).toBe(true);
        await expect(page.getByTestId('start-screen')).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  });
}

test.describe('flow at 1600×720', () => {
  test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });

  test('back pauses and resumes a match, leaves the lobby and the result', async ({ page }) => {
    await open(page, '&lang=en&wins=1&seed=3');
    await page.getByTestId('start-solo').click();
    await game.advance(page, 5);
    expect(await back(page)).toBe(true);
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByTestId('pause-overlay')).toHaveCount(0);
    // Escape does the same on desktop.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.keyboard.press('Escape');

    // Play it out: the result screen lists the match stats.
    await game.until(page, Phase.MATCH_OVER, 20_000);
    await expect(page.getByTestId('result-screen')).toBeVisible();
    await expect(page.getByTestId('result-table')).toBeVisible();
    await expect(page.getByTestId('result-table')).toContainText('KOs');
    await shot(page, 'result-stats.png');
    expect(await back(page)).toBe(true);
    await expect(page.getByTestId('start-screen')).toBeVisible();

    // Lobby → back goes to the party setup.
    await page.getByTestId('start-party').click();
    await page.getByTestId('party-start').click();
    await expect(page.getByTestId('lobby-bar')).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByTestId('party-setup')).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByTestId('start-screen')).toBeVisible();
  });

  test('settings apply and persist: language, larger text, controls, friendly rule', async ({
    page,
  }) => {
    await open(page);
    await page.getByTestId('open-settings').click();
    for (const sec of ['game', 'controls', 'access', 'sound', 'about']) {
      await expect(page.getByTestId(`settings-sec-${sec}`)).toBeVisible();
    }
    await expect(page.getByTestId('about-version')).toContainText('0.');
    await page.getByTestId('language-hu').click();
    await expect(page.getByTestId('settings-sec-game')).toContainText('Nyelv');
    await page.getByTestId('large-text-true').click();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('large-text')),
    ).toBe(true);
    await page.getByTestId('left-handed-true').click();
    await page.getByTestId('friendly-true').click();
    await page.getByTestId('restore-purchases').click();
    await expect(page.getByTestId('restore-status')).toBeVisible();
    await page.getByTestId('settings-touch-test').click();
    await expect(page.getByTestId('touch-tester')).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByTestId('start-screen')).toBeVisible();

    // Restart: everything is still set.
    await page.goto('/?test&game&clock=manual&wins=1&seed=5');
    await page.waitForFunction(() => window.__blastyardGame?.ready === true);
    await expect(page.getByTestId('start-quick')).toContainText('Gyors meccs');
    const s = await page.evaluate(() => window.__blastyardGame!.settings());
    expect(s).toMatchObject({ language: 'hu', largeText: true, leftHanded: true, friendly: true });

    // Left-handed: the solo pop button sits left of the arena.
    await page.getByTestId('start-solo').click();
    const layout = await page.evaluate(() => window.__blastyardGame!.layout());
    const zones = await page.evaluate(() => window.__blastyardGame!.zones());
    expect(zones[0]!.bombCenter!.x).toBeLessThan(layout.arena.x);

    // Friendly rule: sitting on your own pop is safe.
    await game.until(page, Phase.PLAYING, 400);
    await page.keyboard.press('Space');
    await game.advance(page, 200);
    expect((await page.evaluate(() => window.__blastyardGame!.players()))[0]!.alive).toBe(true);
    await shot(page, 'left-handed-solo.png');
  });
});
