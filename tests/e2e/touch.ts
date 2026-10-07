import { type CDPSession, type Page } from '@playwright/test';
// Type-only: brings the `window.__blastyardGame` declaration into scope.
import type {} from '../../src/game/shell';

interface Point {
  id: number;
  x: number;
  y: number;
}

/**
 * Simulated fingers: CDP `Input.dispatchTouchEvent` delivers real multi-touch to Chromium (each
 * point becomes its own pointer), so four fingers can rest on four zones at once.
 */
export class Touch {
  private readonly points = new Map<number, Point>();
  constructor(private readonly cdp: CDPSession) {}

  private async send(
    type: 'touchStart' | 'touchMove' | 'touchEnd',
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

  async up(id: number): Promise<void> {
    const p = this.points.get(id);
    if (!p) return;
    await this.send('touchEnd', [p]);
    this.points.delete(id);
  }

  async upAll(): Promise<void> {
    for (const id of [...this.points.keys()]) await this.up(id);
  }
}

/** The hook calls the e2e tests share. */
export const game = {
  advance: (page: Page, n: number) => page.evaluate((t) => window.__blastyardGame!.advance(t), n),
  until: (page: Page, phase: number, max: number) =>
    page.evaluate(([p, m]) => window.__blastyardGame!.advanceUntilPhase(p!, m!), [phase, max]),
  screen: (page: Page) => page.evaluate(() => window.__blastyardGame!.screen()),
  tick: (page: Page) => page.evaluate(() => window.__blastyardGame!.tick()),
  lobby: (page: Page) => page.evaluate(() => window.__blastyardGame!.lobby()),
  zones: (page: Page) => page.evaluate(() => window.__blastyardGame!.zones()),
  orientations: (page: Page) => page.evaluate(() => window.__blastyardGame!.orientations()),
};

/** Centre of a zone rectangle. */
export function centreOf(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
} {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
