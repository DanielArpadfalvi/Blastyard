import { expect, type BrowserContext, type Page, test } from '@playwright/test';
import type {} from '../../src/game/shell';

/**
 * Online private lobbies end to end: three phones played by three tabs of one browser
 * (`?net=local`: rooms over BroadcastChannel, an identity per tab). Create a lobby, join by code,
 * add a friend by friend code and invite them (they get a notification), start a match and check
 * that every phone runs the same game (state hashes compared between the phones).
 */

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 150_000 });

interface Phone {
  readonly page: Page;
  readonly errors: string[];
}

async function phone(context: BrowserContext, name: string): Promise<Phone> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test&game&net=local&lang=en');
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await page.getByTestId('start-online').click();
  await expect(page.getByTestId('online-screen')).toBeVisible();
  await expect(page.getByTestId('online-friend-code')).not.toContainText('·');
  await page.getByTestId('online-name').fill(name);
  await page.getByTestId('online-name').blur();
  return { page, errors };
}

const friendCode = async (p: Phone): Promise<string> =>
  ((await p.page.getByTestId('online-friend-code').locator('b').textContent()) ?? '').trim();

const net = (p: Phone) => p.page.evaluate(() => window.__blastyardGame!.net());

test('create, join by code, friend invite with a notification, and a synced match', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const anna = await phone(context, 'Anna');
  const bob = await phone(context, 'Bob');
  const cleo = await phone(context, 'Cleo');

  // Cleo adds Anna by her friend code, then waits on the start screen.
  const annaCode = await friendCode(anna);
  await cleo.page.getByTestId('online-friend-input').fill(annaCode);
  await cleo.page.getByTestId('online-add-friend').click();
  await expect(cleo.page.getByTestId('online-friend-status')).toHaveText('Friend added.');
  await expect(cleo.page.getByTestId('online-friends')).toContainText('Anna');
  const cleoCode = await friendCode(cleo);
  await cleo.page.getByTestId('online-back').click();
  await expect(cleo.page.getByTestId('start-screen')).toBeVisible();

  // Anna creates a lobby: a six-character code to share.
  await anna.page.getByTestId('online-create').click();
  await expect(anna.page.getByTestId('online-lobby')).toBeVisible();
  const code = ((await anna.page.getByTestId('lobby-code').textContent()) ?? '').trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // Bob joins with the code (typed in lower case).
  await bob.page.getByTestId('online-code').fill(code.toLowerCase());
  await bob.page.getByTestId('online-join').click();
  await expect(bob.page.getByTestId('online-lobby')).toBeVisible();
  await expect(anna.page.getByTestId('lobby-members')).toContainText('Bob');
  await expect(bob.page.getByTestId('lobby-members')).toContainText('Anna');

  // Anna invites her friend Cleo, who gets a notification on the start screen and joins.
  await anna.page.getByTestId(`lobby-invite-${cleoCode}`).click();
  await expect(cleo.page.getByTestId('invite-toast')).toContainText('Anna invited you');
  await cleo.page.getByTestId('invite-toast-join').click();
  await expect(cleo.page.getByTestId('online-lobby')).toBeVisible();
  await expect(anna.page.getByTestId('lobby-members')).toContainText('Cleo');

  // Guests get ready; the host starts the match.
  await expect(anna.page.getByTestId('lobby-start')).toBeDisabled();
  await bob.page.getByTestId('lobby-ready').click();
  await cleo.page.getByTestId('lobby-ready').click();
  await expect(anna.page.getByTestId('lobby-ready-1')).toHaveText('Ready');
  await expect(anna.page.getByTestId('lobby-ready-2')).toHaveText('Ready');
  await anna.page.getByTestId('lobby-start').click();

  for (const p of [anna, bob, cleo]) await expect(p.page.getByTestId('hud')).toBeVisible();
  expect((await Promise.all([anna, bob, cleo].map(net))).map((n) => n.seat)).toEqual([0, 1, 2]);
  // Every phone advances and the phones compare state hashes along the way.
  await expect
    .poll(
      async () =>
        Math.min(...(await Promise.all([anna, bob, cleo].map(net))).map((n) => n.matched)),
      {
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(2);
  const states = await Promise.all([anna, bob, cleo].map(net));
  for (const s of states) {
    expect(s.desynced).toBe(false);
    expect(s.tick).toBeGreaterThan(240);
  }
  await anna.page.screenshot({ path: 'test-results/online/match-anna.png' });
  for (const p of [anna, bob, cleo]) expect(p.errors).toEqual([]);
  await context.close();
});

test('a wrong code says so; without a backend the Online screen explains it', async ({ page }) => {
  await page.goto('/?test&game&net=local&lang=en');
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await page.getByTestId('start-online').click();
  await page.getByTestId('online-code').fill('ZZZZZZ');
  await page.getByTestId('online-join').click();
  await expect(page.getByTestId('online-error')).toHaveText(/No lobby with this code/, {
    timeout: 15_000,
  });
  await page.goto('/?test&game&lang=en');
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await page.getByTestId('start-online').click();
  await expect(page.getByTestId('online-unavailable')).toBeVisible();
});
