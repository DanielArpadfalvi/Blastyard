import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { encodeInput, INPUT_BOMB } from '../../src/core/input';
import type { InputTestState } from '../../src/input/testPage';

/**
 * Multi-pointer tests against the standalone input harness (`?test&input`). Touches are injected
 * with CDP `Input.dispatchTouchEvent`, which delivers real multi-touch to Chromium (each point
 * becomes its own pointer; `touchStart`/`touchMove` list the active points, `touchEnd` lists the
 * points being lifted).
 */

const UP = 1;
const RIGHT = 2;
const DOWN = 3;
const LEFT = 4;

interface Point {
  id: number;
  x: number;
  y: number;
}

class Touch {
  private points = new Map<number, Point>();
  constructor(private readonly cdp: CDPSession) {}

  private async send(
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Point[] = [...this.points.values()],
  ): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        radiusX: 4,
        radiusY: 4,
        force: 1,
      })),
    });
  }

  async down(id: number, x: number, y: number): Promise<void> {
    this.points.set(id, { id, x, y });
    await this.send('touchStart');
  }

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

  /** Lifts fingers: Chromium's `touchEnd` releases exactly the listed points. */
  async up(...ids: number[]): Promise<void> {
    const lifted = ids.map((id) => this.points.get(id)).filter((p): p is Point => !!p);
    for (const id of ids) this.points.delete(id);
    await this.send('touchEnd', lifted);
  }

  async upAll(): Promise<void> {
    await this.up(...this.points.keys());
  }
}

async function open(page: Page, layout = ''): Promise<{ state: InputTestState; touch: Touch }> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Manual gesture clock: tap timing is driven by the test, not by wall-clock under CPU load.
  await page.goto(`/?test&input&clock=manual${layout ? `&layout=${layout}` : ''}`);
  await page.waitForFunction(() => (window.__blastyardInput?.ticks ?? 0) > 2);
  const state = (await page.evaluate(() => window.__blastyardInput)) as InputTestState;
  expect(errors).toEqual([]);
  const cdp = await page.context().newCDPSession(page);
  return { state, touch: new Touch(cdp) };
}

/** Sets the harness gesture clock (ms) used for the next touch events. */
const setClock = (page: Page, ms: number): Promise<void> =>
  page.evaluate((t) => {
    if (!window.__blastyardInputClock) throw new Error('manual clock not enabled');
    window.__blastyardInputClock.now = t;
  }, ms);

/** Waits for `n` more sampled ticks (state-based, not wall-clock). */
async function waitTicks(page: Page, n: number): Promise<void> {
  const start = await page.evaluate(() => window.__blastyardInput?.ticks ?? 0);
  await page.waitForFunction((t) => (window.__blastyardInput?.ticks ?? 0) >= t, start + n);
}

const bytes = (page: Page): Promise<number[]> =>
  page.evaluate(() => [...(window.__blastyardInput?.bytes ?? [])]);
const bombs = (page: Page): Promise<number[]> =>
  page.evaluate(() => [...(window.__blastyardInput?.bombs ?? [])]);

test('face-off: two zones are driven simultaneously, each finger stays bound to its zone', async ({
  page,
}) => {
  const { state, touch } = await open(page);
  const [left, right] = state.zones.map((z) => z.rect);
  if (!left || !right) throw new Error('missing zones');

  // Seat 0 sits at the left edge (its stick half is the strip's top), seat 1 at the right edge
  // (its stick half is the strip's bottom).
  const a = { x: left.x + left.w / 2, y: left.y + left.h * 0.25 };
  const b = { x: right.x + right.w / 2, y: right.y + right.h * 0.75 };
  await touch.down(1, a.x, a.y);
  await touch.down(2, b.x, b.y);
  await touch.move({ 1: [a.x + 40, a.y], 2: [b.x - 40, b.y] });
  await expect.poll(() => bytes(page)).toEqual([encodeInput(RIGHT), encodeInput(LEFT), 0, 0]);

  // Both turn at once, with a perpendicular secondary component.
  await touch.move({ 1: [a.x + 20, a.y - 45], 2: [b.x - 20, b.y + 45] });
  await expect
    .poll(() => bytes(page))
    .toEqual([encodeInput(UP, RIGHT), encodeInput(DOWN, LEFT), 0, 0]);

  await page.screenshot({ path: test.info().outputPath('input-faceoff-sticks.png') });

  // Third finger: seat 0's bomb button while both sticks are held.
  const bomb = await page.getByTestId('bomb-0').boundingBox();
  if (!bomb) throw new Error('no bomb button');
  await touch.down(3, bomb.x + bomb.width / 2, bomb.y + bomb.height / 2);
  await expect.poll(() => bombs(page)).toEqual([1, 0, 0, 0]);
  await touch.up(3);
  await expect
    .poll(() => bytes(page))
    .toEqual([encodeInput(UP, RIGHT), encodeInput(DOWN, LEFT), 0, 0]);
  expect(await bombs(page)).toEqual([1, 0, 0, 0]);

  // Seat 0's finger slides across the arena into seat 1's zone: still seat 0's stick.
  await touch.move({ 1: [right.x + right.w / 2, a.y] }, 8);
  await expect.poll(() => bytes(page)).toEqual([encodeInput(RIGHT), encodeInput(DOWN, LEFT), 0, 0]);

  // Lifting one finger stops only that seat.
  await touch.up(2);
  await expect.poll(() => bytes(page)).toEqual([encodeInput(RIGHT), 0, 0, 0]);
  await touch.upAll();
  await expect.poll(() => bytes(page)).toEqual([0, 0, 0, 0]);
});

test('touches that start over the arena are ignored', async ({ page }) => {
  const { state, touch } = await open(page);
  const left = state.zones[0]?.rect;
  if (!left) throw new Error('missing zone');
  const start = { x: state.arena.x + state.arena.w / 2, y: state.arena.y + state.arena.h / 2 };
  await touch.down(1, start.x, start.y);
  await touch.move({ 1: [left.x + left.w / 2, left.y + 40] }, 8);
  await touch.move({ 1: [left.x + left.w / 2 + 50, left.y + 40] });
  await waitTicks(page, 5);
  expect(await bytes(page)).toEqual([0, 0, 0, 0]);
  await touch.upAll();
  expect(await bombs(page)).toEqual([0, 0, 0, 0]);
});

test('four corners: one-finger sticks in parallel, tap and second finger place bombs', async ({
  page,
}) => {
  const { state, touch } = await open(page, 'corners');
  expect(state.zones).toHaveLength(4);
  const centre = (i: number): { x: number; y: number } => {
    const r = state.zones[i]?.rect;
    if (!r) throw new Error(`missing zone ${i}`);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const [p0, p1, p2] = [centre(0), centre(1), centre(2)];
  await touch.down(1, p0.x, p0.y);
  await touch.down(2, p1.x, p1.y);
  await touch.down(3, p2.x, p2.y);
  await touch.move({ 1: [p0.x, p0.y - 40], 2: [p1.x - 40, p1.y], 3: [p2.x + 40, p2.y] });
  await expect
    .poll(() => bytes(page))
    .toEqual([encodeInput(UP), encodeInput(LEFT), encodeInput(RIGHT), 0]);

  // Seat 3 taps its corner while the others keep steering.
  const p3 = centre(3);
  await setClock(page, 1000);
  await touch.down(4, p3.x, p3.y);
  await setClock(page, 1179);
  await touch.up(4);
  await expect.poll(() => bombs(page)).toEqual([0, 0, 0, 1]);
  // A press held for 180 ms is not a tap.
  await setClock(page, 2000);
  await touch.down(4, p3.x, p3.y);
  await setClock(page, 2180);
  await touch.up(4);
  await waitTicks(page, 5);
  expect(await bombs(page)).toEqual([0, 0, 0, 1]);

  // Seat 0 adds a second finger in its zone: bomb, and it keeps moving up.
  await touch.down(5, p0.x + 30, p0.y + 20);
  await expect.poll(() => bombs(page)).toEqual([1, 0, 0, 1]);
  expect((await bytes(page))[0]! & ~INPUT_BOMB).toBe(encodeInput(UP));

  await page.screenshot({ path: test.info().outputPath('input-corners.png') });
  await touch.upAll();
  await expect.poll(() => bytes(page)).toEqual([0, 0, 0, 0]);
});

test('keyboard fallback drives two seats', async ({ page }) => {
  await open(page);
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => bytes(page)).toEqual([encodeInput(RIGHT), encodeInput(UP), 0, 0]);
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expect.poll(() => bombs(page)).toEqual([1, 1, 0, 0]);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowUp');
  await expect.poll(() => bytes(page)).toEqual([0, 0, 0, 0]);
});
