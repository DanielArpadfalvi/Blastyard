import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import { game } from './touch';

/**
 * T5.5 game controllers with a mocked `navigator.getGamepads()` (standard mapping): a press claims
 * a seat, the stick steers, A pops, a solo round is played to the result screen; in the party
 * lobby two controllers join the face-off seats and get ready by holding A. Screenshots go to
 * `$BLASTYARD_SHOTS` (default `test-results/gamepad`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'gamepad');

test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 120_000 });

interface FakePadState {
  buttons?: number[];
  axes?: [number, number];
}

declare global {
  interface Window {
    __pads?: Array<unknown>;
  }
}

async function open(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => window.__pads,
    });
  });
  await page.goto(`/?test&game&clock=manual&lang=en${query}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  return errors;
}

/** Sets controller `index` to the given held buttons and left-stick axes. */
function pad(page: Page, index: number, state: FakePadState): Promise<void> {
  return page.evaluate(
    ([i, s]) => {
      const held = new Set(s.buttons ?? []);
      window.__pads![i] = {
        index: i,
        id: `Fake pad ${i}`,
        connected: true,
        mapping: 'standard',
        buttons: Array.from({ length: 17 }, (_, b) => ({
          pressed: held.has(b),
          touched: held.has(b),
          value: held.has(b) ? 1 : 0,
        })),
        axes: [...(s.axes ?? [0, 0]), 0, 0],
        timestamp: 0,
      };
    },
    [index, state] as const,
  );
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

const A = 0;
const players = (page: Page) => page.evaluate(() => window.__blastyardGame!.players());

test('a controller claims the solo seat, steers, pops and plays the round out', async ({
  page,
}) => {
  const errors = await open(page, '&wins=1&seed=7');
  await pad(page, 0, {});
  await page.getByTestId('start-solo').click();
  await game.advance(page, 2);
  expect(await page.evaluate(() => window.__blastyardGame!.gamepadSeats())).toEqual([]);

  // The first press claims seat 0 (and is not a pop).
  await pad(page, 0, { buttons: [A] });
  await game.advance(page, 1);
  await pad(page, 0, {});
  expect(await page.evaluate(() => window.__blastyardGame!.gamepadSeats())).toEqual([0]);
  await expect(page.getByTestId('pad-badge-0')).toBeVisible();

  // Through the countdown, then the stick moves the Puff right (seat 0 starts top-left).
  await game.until(page, Phase.PLAYING, 400);
  const before = (await players(page))[0]!;
  await pad(page, 0, { axes: [1, 0] });
  await game.advance(page, 40);
  await pad(page, 0, {});
  await game.advance(page, 1);
  const after = (await players(page))[0]!;
  expect(after.x).toBeGreaterThan(before.x + 0.5); // up to the first crate
  expect(after.y).toBe(before.y);

  // A pops (the bot may have pops of its own on the field).
  const bombs = () => page.evaluate(() => window.__blastyardGame!.bombs());
  const field = await bombs();
  await pad(page, 0, { buttons: [A] });
  await game.advance(page, 1);
  expect(await bombs()).toBe(field + 1);
  await pad(page, 0, { axes: [-1, 0] });
  await game.advance(page, 1);
  await shot(page, 'gamepad-solo.png');

  // Let the round play out (the bot, the clock and the spiral decide it).
  await pad(page, 0, {});
  await game.until(page, Phase.MATCH_OVER, 20_000);
  await expect(page.getByTestId('result-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('two controllers join the face-off lobby and get ready by holding A', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-party').click();
  await expect(page.getByTestId('party-setup')).toBeVisible();
  await page.getByTestId('party-layout-faceoff').click();
  await page.getByTestId('party-start').click();
  await expect(page.getByTestId('lobby-bar')).toBeVisible();
  const humans = (await game.lobby(page))!.map((v) => v.seat);
  expect(humans.length).toBeGreaterThanOrEqual(1);

  // Each controller claims the next free human seat with its first press.
  for (let i = 0; i < humans.length; i++) {
    await pad(page, i, { buttons: [A] });
    await game.advance(page, 1);
    await pad(page, i, {});
    await game.advance(page, 1);
  }
  expect(await page.evaluate(() => window.__blastyardGame!.gamepadSeats())).toEqual(humans);
  for (const seat of humans) {
    await expect(page.getByTestId(`pad-badge-${seat}`)).toBeVisible();
    await expect(page.getByTestId(`lobby-seat-${seat}`)).toContainText('hold A');
  }
  await shot(page, 'gamepad-lobby.png');

  // Holding A (a pop, then a resting hold) for a second makes every seat ready.
  for (let i = 0; i < humans.length; i++) await pad(page, i, { buttons: [A] });
  await game.advance(page, 70);
  expect((await game.lobby(page))!.every((v) => v.joined && v.ready)).toBe(true);
  await page.evaluate(() => window.__blastyardGame!.advanceUntilLobbyDone(200));
  await page.waitForFunction(() => window.__blastyardGame!.screen() === 'playing');
  // The claims carry over into the match.
  expect(await page.evaluate(() => window.__blastyardGame!.gamepadSeats())).toEqual(humans);
});
