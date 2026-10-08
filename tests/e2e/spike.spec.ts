import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { Phase } from '../../src/core/state';
import type { ZoneSpec } from '../../src/input/zones';
// Type-only: brings the `window.__blastyardGame` declaration into scope.
import type {} from '../../src/game/shell';

/**
 * T2.4 device-spike tools: the touch tester (`?touchtest`, or from the start screen of the web
 * preview / `?spike`) and the four-corner prototype. Multi-touch is injected with CDP
 * `Input.dispatchTouchEvent` (real TouchEvents + PointerEvents in Chromium). Screenshots go to
 * `$BLASTYARD_SHOTS` when set, otherwise to `test-results/spike/`.
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'spike');
const SCREENS = [
  { width: 1600, height: 720 },
  { width: 2048, height: 1536 },
] as const;

interface Point {
  id: number;
  x: number;
  y: number;
}

class Touch {
  private readonly points = new Map<number, Point>();
  constructor(private readonly cdp: CDPSession) {}

  private async send(
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    points: Point[] = [...this.points.values()],
  ): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, radiusX: 4, radiusY: 4, force: 1 })),
    });
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.points.set(id, { id, x, y });
    await this.send('touchStart');
  }

  /** Moves several touches together in `steps` events. */
  async move(moves: Record<number, [number, number]>, steps = 4): Promise<void> {
    const from = new Map([...this.points].map(([id, p]) => [id, { ...p }]));
    for (let i = 1; i <= steps; i++) {
      for (const [key, [x, y]] of Object.entries(moves)) {
        const id = Number(key);
        const start = from.get(id);
        if (!start) throw new Error(`touch ${id} is not down`);
        this.points.set(id, {
          id,
          x: start.x + ((x - start.x) * i) / steps,
          y: start.y + ((y - start.y) * i) / steps,
        });
      }
      await this.send('touchMove');
    }
  }

  async up(id: number): Promise<void> {
    const p = this.points.get(id);
    if (!p) return;
    this.points.delete(id);
    await this.send('touchEnd', [p]);
  }

  /** The "system" takes every active touch (as an edge gesture would). */
  async cancelAll(): Promise<void> {
    await this.send('touchCancel', []);
    this.points.clear();
  }
}

function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: join(SHOT_DIR, name) });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const hook = {
  advance: (page: Page, n: number) => page.evaluate((t) => window.__blastyardGame!.advance(t), n),
  until: (page: Page, phase: number, max: number) =>
    page.evaluate(([p, m]) => window.__blastyardGame!.advanceUntilPhase(p!, m!), [phase, max]),
  players: (page: Page) => page.evaluate(() => window.__blastyardGame!.players()),
  zones: (page: Page) =>
    page.evaluate(() => window.__blastyardGame!.zones()) as Promise<ZoneSpec[]>,
};

test.describe('device-spike tools', () => {
  test('start screen shows the device tools only in the preview (?spike)', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/?lang=en');
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await expect(page.getByTestId('spike-tools')).toHaveCount(0);

    await page.goto('/?spike&lang=hu');
    await expect(page.getByTestId('spike-tools')).toBeVisible();
    await shot(page, 'start-spike-phone-hu.png');
    await expect(page.getByTestId('start-touchtest')).toContainText('Érintés-teszt');
    await page.getByTestId('start-touchtest').click();
    await expect(page.getByTestId('touch-tester')).toBeVisible();
    await expect(page.getByTestId('start-screen')).toHaveCount(0);
    await page.getByTestId('tt-back').click();
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await expect(page.getByTestId('touch-tester')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the menu backdrop is not drawn behind the opaque touch tester', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/?test&game&spike&lang=en');
    await page.waitForFunction(() => window.__blastyardGame?.ready === true);
    const frames = () => page.evaluate(() => window.__blastyardGame!.frames());
    const advances = async () => {
      const a = await frames();
      await page.waitForTimeout(500);
      return (await frames()) > a;
    };
    expect(await advances()).toBe(true);
    await page.getByTestId('start-touchtest').click();
    await expect(page.getByTestId('touch-tester')).toBeVisible();
    await page.waitForTimeout(100);
    expect(await advances()).toBe(false);
    await page.getByTestId('tt-back').click();
    await expect(page.getByTestId('start-screen')).toBeVisible();
    expect(await advances()).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const screen of SCREENS) {
    const tag = `${screen.width}x${screen.height}`;

    test.describe(tag, () => {
      test.use({ viewport: screen, deviceScaleFactor: 1 });
      // Large screenshots on a loaded runner: same headroom as play.spec.
      test.describe.configure({ timeout: 60_000 });

      test('touch tester counts simultaneous touches and cancels, copies a report', async ({
        page,
        context,
      }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const errors = watchErrors(page);
        await page.goto('/?touchtest&lang=en');
        await expect(page.getByTestId('touch-tester')).toBeVisible();
        await expect(page.getByTestId('tt-screen')).toContainText(
          `${screen.width}×${screen.height} dp`,
        );
        const touch = new Touch(await page.context().newCDPSession(page));
        const { width: w, height: h } = screen;

        // Four fingers at once, one per corner area; then they spread a little.
        const spots: Array<[number, number]> = [
          [w * 0.05, h * 0.3],
          [w * 0.95, h * 0.3],
          [w * 0.05, h * 0.7],
          [w * 0.95, h * 0.7],
        ];
        for (const [i, [x, y]] of spots.entries()) await touch.down(i + 1, x, y);
        await touch.move({ 1: [w * 0.06, h * 0.35], 4: [w * 0.94, h * 0.65] });
        await expect(page.getByTestId('tt-active')).toHaveText('4');
        await expect(page.getByTestId('tt-max')).toHaveText('4');
        await expect(page.getByTestId('tt-max-touch')).toHaveText('4');
        await expect(page.getByTestId('tt-dot')).toHaveCount(4);
        await shot(page, `touchtest-${tag}.png`);

        // Lifting one finger keeps the maximum.
        await touch.up(2);
        await expect(page.getByTestId('tt-active')).toHaveText('3');
        await expect(page.getByTestId('tt-max')).toHaveText('4');

        // The system cancels the remaining three (as an edge gesture would).
        await touch.cancelAll();
        await expect(page.getByTestId('tt-active')).toHaveText('0');
        await expect(page.getByTestId('tt-pointer-cancels')).toHaveText('3');
        await expect(page.getByTestId('tt-touch-cancels')).toHaveText('1');
        await expect(page.getByTestId('tt-edges')).toContainText('left 2');
        await expect(page.getByTestId('tt-edges')).toContainText('right 1');

        // Copy report → clipboard (via the platform layer).
        await page.getByTestId('tt-copy').click();
        await expect(page.getByTestId('tt-copy')).toHaveText('Copied!');
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toContain('Blastyard touch test');
        expect(copied).toContain('Most at once: 4 (pointer) / 4 (touch events)');
        expect(copied).toContain('Cancelled touches: 3 (pointer) / 1 (touch events)');
        expect(copied).toContain(`${screen.width}×${screen.height} dp`);
        expect(copied).toContain(await page.evaluate(() => navigator.userAgent));
        await shot(page, `touchtest-after-${tag}.png`);

        await page.getByTestId('tt-reset').click();
        await expect(page.getByTestId('tt-max')).toHaveText('0');
        await expect(page.getByTestId('tt-pointer-cancels')).toHaveText('0');
        expect(errors).toEqual([]);
      });

      test('four-corner prototype: four one-finger seats steer and pop', async ({ page }) => {
        const errors = watchErrors(page);
        await page.goto('/?test&game&clock=manual&seed=7&wins=2&spike&lang=en');
        await page.waitForFunction(() => window.__blastyardGame?.ready === true);
        await page.getByTestId('start-corners').click();
        await expect(page.getByTestId('hud')).toBeVisible();
        expect(await page.evaluate(() => window.__blastyardGame!.mode())).toBe('corners');
        for (let s = 0; s < 4; s++) await expect(page.getByTestId(`seat-panel-${s}`)).toBeVisible();

        const zones = await hook.zones(page);
        expect(zones.map((z) => [z.seat, z.orientation, z.scheme])).toEqual([
          [0, 180, 'oneFinger'],
          [1, 180, 'oneFinger'],
          [2, 0, 'oneFinger'],
          [3, 0, 'oneFinger'],
        ]);
        const layout = await page.evaluate(() => window.__blastyardGame!.layout());
        for (const z of zones) {
          const outside =
            z.rect.x + z.rect.w <= layout.arena.x || z.rect.x >= layout.arena.x + layout.arena.w;
          expect(outside).toBe(true);
        }

        await hook.until(page, Phase.PLAYING, 400);
        const before = await hook.players(page);
        const touch = new Touch(await page.context().newCDPSession(page));
        const centre = (z: ZoneSpec): [number, number] => [
          z.rect.x + z.rect.w / 2,
          z.rect.y + z.rect.h / 2,
        ];
        // Each Puff walks out of its corner along the long side: the left two go right, the
        // right two go left (stick vectors are in screen space).
        for (const [i, z] of zones.entries()) {
          const [x, y] = centre(z);
          await touch.down(i + 1, x, y);
        }
        const moves: Record<number, [number, number]> = {};
        for (const [i, z] of zones.entries()) {
          const [x, y] = centre(z);
          moves[i + 1] = [x + (z.seat % 2 === 0 ? 50 : -50), y];
        }
        await touch.move(moves);
        await hook.advance(page, 10);
        const after = await hook.players(page);
        expect(after[0]!.x).toBeGreaterThan(before[0]!.x);
        expect(after[1]!.x).toBeLessThan(before[1]!.x);
        expect(after[2]!.x).toBeGreaterThan(before[2]!.x);
        expect(after[3]!.x).toBeLessThan(before[3]!.x);
        await shot(page, `corners-${tag}.png`);
        for (let i = 1; i <= 4; i++) await touch.up(i);

        // A short tap in a corner zone drops a pop (one-finger scheme).
        await page.evaluate(() => (window.__blastyardGame!.pointerClock.now = 1000));
        const [tx, ty] = centre(zones[0]!);
        await touch.down(9, tx, ty);
        await page.evaluate(() => (window.__blastyardGame!.pointerClock.now = 1050));
        await touch.up(9);
        await hook.advance(page, 1);
        expect(await page.evaluate(() => window.__blastyardGame!.bombs())).toBe(1);
        expect(errors).toEqual([]);
      });
    });
  }

  test('four-corner prototype with bots: bot seats have no zone', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/?test&game&clock=manual&seed=3&spike&lang=hu');
    await page.waitForFunction(() => window.__blastyardGame?.ready === true);
    await page.getByTestId('corner-bots').click();
    await page.getByTestId('corner-bots').click();
    await expect(page.getByTestId('corner-bots')).toHaveText('Botok: 2');
    await page.getByTestId('start-corners').click();
    await expect(page.getByTestId('hud')).toBeVisible();
    expect((await hook.zones(page)).map((z) => z.seat)).toEqual([0, 1]);
    await hook.until(page, Phase.PLAYING, 400);
    const start = await hook.players(page);
    await hook.advance(page, 120);
    // The bots wander out of their corners on their own; the idle players stay put.
    const later = await hook.players(page);
    const moved = (i: number): boolean =>
      later[i]!.x !== start[i]!.x || later[i]!.y !== start[i]!.y || !later[i]!.alive;
    expect(moved(2) || moved(3)).toBe(true);
    expect(later[0]).toEqual(start[0]);
    expect(errors).toEqual([]);
  });
});
