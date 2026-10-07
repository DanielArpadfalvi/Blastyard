import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import { centreOf, game, Touch } from './touch';

/**
 * T5.1 party & table mode: seat setup, the warm-up lobby (join by touching a zone, ready by resting
 * a finger for a second), seat orientation arrows, presets / 2v2 / best-of, the arena picker with
 * lock badges, hold-to-pause, auto-pause and Quick Match. Time is test-driven (`clock=manual`);
 * fingers are CDP touches. Screenshots go to `$BLASTYARD_SHOTS` (default `test-results/party`).
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'party');
const SEED = 7;

test.use({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
test.describe.configure({ timeout: 60_000 });

async function open(page: Page, extra = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&game&clock=manual&seed=${SEED}&lang=en${extra}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  return errors;
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

/** Opens the party setup and puts every seat in play as a human at the four corners. */
async function fourCorners(page: Page): Promise<void> {
  await page.getByTestId('start-party').click();
  await expect(page.getByTestId('party-setup')).toBeVisible();
  await page.getByTestId('party-layout-corners').click();
  await page.getByTestId('party-seat-2').click();
  await page.getByTestId('party-seat-3').click();
  for (const seat of [0, 1, 2, 3]) {
    await expect(page.getByTestId(`party-seat-${seat}`)).toContainText('Player');
  }
}

test('four simulated pointers join, get ready and finish a round', async ({ page }) => {
  const errors = await open(page);
  await fourCorners(page);
  await page.getByTestId('party-wins-1').click();
  await page.getByTestId('party-start').click();
  await expect(page.getByTestId('lobby-bar')).toBeVisible();
  expect(await game.screen(page)).toBe('lobby');
  for (const seat of [0, 1, 2, 3]) {
    await expect(page.getByTestId(`lobby-seat-${seat}`)).toHaveAttribute('data-state', 'idle');
  }

  // Everybody touches their own corner zone: all four join.
  const zones = await game.zones(page);
  expect(zones.map((z) => z.seat)).toEqual([0, 1, 2, 3]);
  const touch = new Touch(await page.context().newCDPSession(page));
  for (const z of zones) {
    const c = centreOf(z.rect);
    await touch.down(z.seat, c.x, c.y);
  }
  await game.advance(page, 5);
  expect((await game.lobby(page))!.map((v) => v.joined)).toEqual([true, true, true, true]);
  expect((await game.lobby(page))!.some((v) => v.ready)).toBe(false);
  await shot(page, 'lobby-joined.png');

  // Rest the fingers for a second: ready; the match follows by itself.
  await game.advance(page, 70);
  expect((await game.lobby(page))!.map((v) => v.ready)).toEqual([true, true, true, true]);
  for (const seat of [0, 1, 2, 3]) {
    await expect(page.getByTestId(`lobby-seat-${seat}`)).toHaveAttribute('data-state', 'ready');
  }
  await page.evaluate(() => window.__blastyardGame!.advanceUntilLobbyDone(200));
  await page.waitForFunction(() => window.__blastyardGame!.screen() === 'playing');
  await touch.upAll();

  // Per-seat HUD rotation: top seats face down the table, bottom seats up.
  const rotation = async (seat: number): Promise<string> =>
    (await page
      .getByTestId(`seat-panel-${seat}`)
      .evaluate((el) => (el as HTMLElement).style.transform)) ?? '';
  expect(await rotation(0)).toContain('rotate(180deg)');
  expect(await rotation(1)).toContain('rotate(180deg)');
  expect(await rotation(2)).toContain('rotate(0deg)');
  expect(await rotation(3)).toContain('rotate(0deg)');
  await game.until(page, Phase.PLAYING, 400);
  await game.advance(page, 30);
  await shot(page, 'match-corners.png');

  // Four idle players: the closing spiral decides the round (first to 1 wins the match).
  await game.until(page, Phase.MATCH_OVER, 30_000);
  await expect(page.getByTestId('result-screen')).toBeVisible();
  const wins = await Promise.all(
    [0, 1, 2, 3].map(async (s) => Number(await page.getByTestId(`result-wins-${s}`).textContent())),
  );
  expect(wins.reduce((a, b) => a + b, 0)).toBe(1);
  expect(errors).toEqual([]);
});

test('touches starting over the arena are ignored in the lobby', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-party').click();
  await page.getByTestId('party-start').click();
  await expect(page.getByTestId('lobby-bar')).toBeVisible();
  const layout = await page.evaluate(() => window.__blastyardGame!.layout());
  const touch = new Touch(await page.context().newCDPSession(page));
  // Seat 0 and 1 are the two strips: a palm resting on the arena joins nobody and readies nobody.
  await touch.down(9, layout.arena.x + layout.arena.w / 2, layout.arena.y + layout.arena.h * 0.6);
  await game.advance(page, 120);
  expect((await game.lobby(page))!.every((v) => !v.joined && !v.ready)).toBe(true);
  // The same finger on a real zone joins at once.
  const [z0] = await game.zones(page);
  const c = centreOf(z0!.rect);
  await touch.down(1, c.x, c.y);
  await game.advance(page, 3);
  expect((await game.lobby(page))![0]!.joined).toBe(true);
  await touch.upAll();
});

test('seat arrows turn a seat 90 degrees and the match keeps it', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-party').click();
  await page.getByTestId('party-start').click();
  await expect(page.getByTestId('lobby-bar')).toBeVisible();
  expect((await game.orientations(page)).slice(0, 2)).toEqual([90, 270]);
  await page.getByTestId('turn-seat-0').click();
  expect((await game.orientations(page))[0]).toBe(180);
  const rot = await page
    .getByTestId('lobby-seat-0')
    .evaluate((el) => (el as HTMLElement).style.transform);
  expect(rot).toContain('rotate(180deg)');
  // "Everyone ready" (a11y shortcut) starts the match with the turned seat.
  await page.getByTestId('lobby-ready-all').click();
  await page.evaluate(() => window.__blastyardGame!.advanceUntilLobbyDone(200));
  await page.waitForFunction(() => window.__blastyardGame!.screen() === 'playing');
  expect((await game.orientations(page))[0]).toBe(180);
});

test('presets, 2v2 and best-of reach the match', async ({ page }) => {
  await open(page);
  await fourCorners(page);
  // 2v2 needs all four seats in play; Fast preset; first to 5.
  await page.getByTestId('party-teams-true').click();
  await page.getByTestId('party-preset-fast').click();
  await page.getByTestId('party-wins-5').click();
  await page.getByTestId('party-start').click();
  await page.getByTestId('lobby-ready-all').click();
  await page.evaluate(() => window.__blastyardGame!.advanceUntilLobbyDone(200));
  await page.waitForFunction(() => window.__blastyardGame!.screen() === 'playing');
  const hud = await page.evaluate(() => window.__blastyardGame!.hud());
  expect(hud.seconds).toBe(90);
  expect(hud.winsToMatch).toBe(5);
  await expect(page.getByTestId('team-tag-0')).toHaveText('Team 1');
  await expect(page.getByTestId('team-tag-1')).toHaveText('Team 1');
  await expect(page.getByTestId('team-tag-2')).toHaveText('Team 2');
});

test('seats cycle through player, four bot levels and empty; 2v2 needs a full table', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('start-party').click();
  const seat = page.getByTestId('party-seat-2');
  await expect(seat).toContainText('Empty');
  // Face-off: seats 3 and 4 cannot be human, so the cycle starts with the bots.
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    await seat.click();
    seen.push((await seat.textContent()) ?? '');
  }
  expect(seen[0]).toContain('Easy');
  expect(seen[1]).toContain('Normal');
  expect(seen[2]).toContain('Hard');
  expect(seen[3]).toContain('Expert');
  expect(seen[4]).toContain('Empty');
  await expect(page.getByTestId('party-teams-true')).toBeDisabled();
  await seat.click();
  await page.getByTestId('party-seat-3').click();
  await expect(page.getByTestId('party-teams-true')).toBeEnabled();
});

test('arena picker: twelve arenas, Blastyard+ ones locked by the mock entitlement', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('start-party').click();
  await page.getByTestId('party-arena').click();
  await expect(page.getByTestId('arena-picker')).toBeVisible();
  const cards = page.locator('[data-testid^="arena-"][data-testid$="-x"], .arena-grid > button');
  await expect(cards).toHaveCount(13); // twelve arenas + random
  await expect(page.locator('[data-testid^="lock-"]')).toHaveCount(6);
  await shot(page, 'arena-picker.png');
  await page.getByTestId('arena-maze').click({ force: true });
  await expect(page.getByTestId('plus-hint')).toBeVisible();
  await page.getByTestId('arena-rink').click();
  await expect(page.getByTestId('arena-rink')).toHaveClass(/arena-on/);
  await page.getByTestId('arena-close').click();
  await page.getByTestId('party-start').click();
  expect(await page.evaluate(() => window.__blastyardGame!.arena())).toBe('rink');
});

test('with Blastyard+ no arena is locked and a Plus arena can be played', async ({ page }) => {
  await open(page, '&plus');
  await page.getByTestId('start-party').click();
  await page.getByTestId('party-arena').click();
  await expect(page.locator('[data-testid^="lock-"]')).toHaveCount(0);
  await page.getByTestId('arena-maze').click();
  await expect(page.getByTestId('arena-maze')).toHaveClass(/arena-on/);
  await page.getByTestId('arena-close').click();
  await page.getByTestId('party-start').click();
  expect(await page.evaluate(() => window.__blastyardGame!.arena())).toBe('maze');
});

test('quick match starts at once; hold-to-pause, resume and auto-pause on background', async ({
  page,
}) => {
  const errors = await open(page);
  await page.getByTestId('start-quick').click();
  await page.waitForFunction(() => window.__blastyardGame!.screen() === 'playing');
  const hud = await page.evaluate(() => window.__blastyardGame!.hud());
  expect(hud.seats.filter((s) => s.active)).toHaveLength(4);
  await game.until(page, Phase.PLAYING, 400);
  await game.advance(page, 30);

  // A short touch on the pause button does nothing; holding for 0.6 s pauses.
  const button = page.getByTestId('pause-button');
  const box = (await button.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__blastyardGame!.paused())).toBe(false);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByTestId('pause-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__blastyardGame!.paused())).toBe(true);
  const frozen = await game.tick(page);
  await game.advance(page, 120);
  expect(await game.tick(page)).toBe(frozen);
  await shot(page, 'paused.png');
  await page.getByTestId('pause-resume').click();
  expect(await page.evaluate(() => window.__blastyardGame!.paused())).toBe(false);
  await game.advance(page, 10);
  expect(await game.tick(page)).toBe(frozen + 10);

  // Going to the background pauses by itself.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('pause-overlay')).toBeVisible();
  await page.getByTestId('pause-leave').click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  expect(errors).toEqual([]);
});
