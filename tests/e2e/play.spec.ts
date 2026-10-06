import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import { defaultBombCenter, type ZoneSpec } from '../../src/input/zones';
// Type-only: brings the `window.__blastyardGame` declaration into scope.
import type {} from '../../src/game/shell';

/**
 * T2.3 first playable: start screen → solo / face-off match → result → start screen.
 *
 * Time is fully test-driven: `clock=manual` keeps the simulation still until the test advances
 * it through `window.__blastyardGame`, and every input (keys, CDP touches) is sampled by the
 * next simulated tick. Screenshots go to `$BLASTYARD_SHOTS` when set (Playwright wipes
 * `test-results` every run), otherwise to `test-results/play/`.
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'play');
const WINS = 2;
const SEED = 7;

const SCREENS = [
  { width: 1600, height: 720 },
  { width: 2400, height: 1080 },
] as const;
const LANGS = ['en', 'hu'] as const;

class Touch {
  private readonly points = new Map<number, { id: number; x: number; y: number }>();
  constructor(private readonly cdp: CDPSession) {}

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd', ids?: number[]): Promise<void> {
    const pts = ids
      ? ids.map((id) => this.points.get(id)!).filter(Boolean)
      : [...this.points.values()];
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p) => ({ ...p, radiusX: 4, radiusY: 4, force: 1 })),
    });
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.points.set(id, { id, x, y });
    await this.send('touchStart');
  }

  async move(id: number, x: number, y: number, steps = 4): Promise<void> {
    const p = this.points.get(id);
    if (!p) throw new Error(`touch ${id} is not down`);
    const from = { ...p };
    for (let i = 1; i <= steps; i++) {
      this.points.set(id, {
        id,
        x: from.x + ((x - from.x) * i) / steps,
        y: from.y + ((y - from.y) * i) / steps,
      });
      await this.send('touchMove');
    }
  }

  async up(id: number): Promise<void> {
    const p = this.points.get(id);
    if (!p) return;
    await this.send('touchEnd', [id]);
    this.points.delete(id);
  }
}

async function open(page: Page, lang: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?test&game&clock=manual&seed=${SEED}&wins=${WINS}&lang=${lang}`);
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  return errors;
}

const hook = {
  advance: (page: Page, n: number) => page.evaluate((t) => window.__blastyardGame!.advance(t), n),
  until: (page: Page, phase: number, max: number) =>
    page.evaluate(([p, m]) => window.__blastyardGame!.advanceUntilPhase(p!, m!), [phase, max]),
  phase: (page: Page) => page.evaluate(() => window.__blastyardGame!.phase()),
  players: (page: Page) => page.evaluate(() => window.__blastyardGame!.players()),
  screen: (page: Page) => page.evaluate(() => window.__blastyardGame!.screen()),
};

/** Runs the current round (already PLAYING) until it is decided; returns the new phase. */
async function finishRound(page: Page): Promise<number> {
  for (let i = 0; i < 40; i++) {
    await hook.advance(page, 60);
    const phase = await hook.phase(page);
    if (phase !== Phase.PLAYING) return phase;
  }
  throw new Error('round did not end');
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

for (const screen of SCREENS) {
  for (const lang of LANGS) {
    const tag = `${screen.width}x${screen.height}-${lang}`;

    test.describe(`first playable ${tag}`, () => {
      test.use({ viewport: screen, deviceScaleFactor: 1 });
      // Whole matches plus large screenshots: some headroom for a loaded CI runner.
      test.describe.configure({ timeout: 60_000 });

      test('solo vs. the wander bot: keyboard play, rounds, result, back to start', async ({
        page,
      }) => {
        const errors = await open(page, lang);
        await shot(page, `start-${tag}.png`);
        await page.getByTestId('start-solo').click();
        await expect(page.getByTestId('hud')).toBeVisible();
        expect(await hook.screen(page)).toBe('playing');
        await expect(page.getByTestId('seat-panel-0')).toBeVisible();
        await expect(page.getByTestId('seat-panel-1')).toBeVisible();

        // Countdown, then the keyboard steers seat 0 out of its corner.
        await hook.until(page, Phase.PLAYING, 400);
        const start = (await hook.players(page))[0]!;
        await page.keyboard.down('KeyD');
        await hook.advance(page, 12);
        await page.keyboard.up('KeyD');
        const moved = (await hook.players(page))[0]!;
        expect(moved.x).toBeGreaterThan(start.x);
        expect(moved.y).toBe(start.y);
        await page.keyboard.down('ArrowLeft');
        await hook.advance(page, 12);
        await page.keyboard.up('ArrowLeft');
        expect((await hook.players(page))[0]!.x).toBeLessThan(moved.x);

        // Mid-round: the bot has been wandering and digging; wait for a pop on the field.
        for (
          let i = 0;
          i < 60 && (await page.evaluate(() => window.__blastyardGame!.bombs())) === 0;
          i++
        ) {
          await hook.advance(page, 10);
        }
        expect(await page.evaluate(() => window.__blastyardGame!.bombs())).toBeGreaterThan(0);
        await hook.advance(page, 60);
        await shot(page, `solo-${tag}.png`);

        // Every round: seat 0 drops a pop under itself and waits.
        let phase: number = Phase.PLAYING;
        for (let round = 0; round < 6 && phase !== Phase.MATCH_OVER; round++) {
          if (round > 0) await hook.until(page, Phase.PLAYING, 600);
          await page.keyboard.press('Space');
          phase = await finishRound(page);
          if (phase === Phase.ROUND_OVER) {
            await expect(page.getByTestId('hud-banner').first()).toBeVisible();
          }
        }
        expect(phase).toBe(Phase.MATCH_OVER);
        await hook.until(page, Phase.MATCH_OVER, 200);
        await expect(page.getByTestId('result-screen')).toBeVisible();
        const hud = await page.evaluate(() => window.__blastyardGame!.hud());
        const winner = hud.matchWinner;
        expect(winner).toBeGreaterThanOrEqual(0);
        await expect(page.getByTestId(`result-wins-${winner}`)).toHaveText(String(WINS));
        await shot(page, `result-solo-${tag}.png`);

        await page.getByTestId('to-menu').click();
        await expect(page.getByTestId('start-screen')).toBeVisible();
        expect(await hook.screen(page)).toBe('menu');
        expect(errors).toEqual([]);
      });

      test('face-off: both strips are touch zones, three rounds to a result', async ({ page }) => {
        const errors = await open(page, lang);
        await page.getByTestId('start-faceoff').click();
        await expect(page.getByTestId('hud')).toBeVisible();
        const zones = (await page.evaluate(() => window.__blastyardGame!.zones())) as ZoneSpec[];
        expect(zones.map((z) => [z.seat, z.orientation])).toEqual([
          [0, 90],
          [1, 270],
        ]);
        const layout = await page.evaluate(() => window.__blastyardGame!.layout());
        const [left, right] = zones.map((z) => z.rect) as [ZoneSpec['rect'], ZoneSpec['rect']];
        // Zones live in the side strips, never over the arena.
        expect(left.x + left.w).toBeLessThanOrEqual(layout.arena.x);
        expect(right.x).toBeGreaterThanOrEqual(layout.arena.x + layout.arena.w);
        const bomb0 = defaultBombCenter(zones[0]!);
        const bomb1 = defaultBombCenter(zones[1]!);
        const touch = new Touch(await page.context().newCDPSession(page));

        await hook.until(page, Phase.PLAYING, 400);
        // Seat 1 sits at the right edge: its stick half is the strip's lower part. Pushing away
        // from the right edge (screen left) walks its Puff left; seat 0 pushes screen-down.
        const before = await hook.players(page);
        const s1 = { x: right.x + right.w / 2, y: right.y + right.h * 0.8 };
        const s0 = { x: left.x + left.w / 2, y: left.y + left.h * 0.25 };
        await touch.down(1, s1.x, s1.y);
        await touch.down(2, s0.x, s0.y);
        await touch.move(1, s1.x - 50, s1.y);
        await touch.move(2, s0.x, s0.y + 50);
        await hook.advance(page, 10);
        const after = await hook.players(page);
        expect(after[1]!.x).toBeLessThan(before[1]!.x);
        expect(after[0]!.y).toBeGreaterThan(before[0]!.y);
        await shot(page, `faceoff-${tag}.png`);
        await touch.up(1);
        await touch.up(2);

        // Round 1: seat 1 taps its bomb button and stays → seat 0 takes the round.
        await touch.down(3, bomb1.x, bomb1.y);
        await hook.advance(page, 1);
        await touch.up(3);
        expect(await finishRound(page)).toBe(Phase.ROUND_OVER);
        expect((await hook.players(page))[1]!.alive).toBe(false);
        await expect(page.getByTestId('hud-banner')).toHaveCount(2);

        // Round 2: seat 0 taps its bomb button → seat 1 levels.
        await hook.until(page, Phase.PLAYING, 600);
        await touch.down(4, bomb0.x, bomb0.y);
        await hook.advance(page, 1);
        await touch.up(4);
        expect(await finishRound(page)).toBe(Phase.ROUND_OVER);

        // Round 3 (decider): seat 0 drops a pop from the keyboard → seat 1 wins the match.
        await hook.until(page, Phase.PLAYING, 600);
        await page.keyboard.press('Space');
        expect(await finishRound(page)).toBe(Phase.MATCH_OVER);
        await hook.until(page, Phase.MATCH_OVER, 200);
        await expect(page.getByTestId('result-screen')).toBeVisible();
        await expect(page.getByTestId('result-wins-0')).toHaveText('1');
        await expect(page.getByTestId('result-wins-1')).toHaveText(String(WINS));
        await shot(page, `result-faceoff-${tag}.png`);

        // Play again starts a fresh face-off match.
        await page.getByTestId('play-again').click();
        await expect(page.getByTestId('result-screen')).toBeHidden();
        expect(await hook.screen(page)).toBe('playing');
        expect(await page.evaluate(() => window.__blastyardGame!.round())).toBe(1);
        expect(errors).toEqual([]);
      });
    });
  }
}
