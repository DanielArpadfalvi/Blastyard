import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Phase } from '../../src/core/state';
// Type-only: bring the `window.__blastyard*` declarations into scope.
import type {} from '../../src/game/arenaDevView';
import type { FxStats } from '../../src/render/arenaView';
import type {} from '../../src/game/shell';

/**
 * T3.1–T3.3 game feel: effects (chain reaction, sudden-death drops, reduced motion), audio
 * (nothing before the first user gesture), settings and game speed. Screenshots go to
 * `$BLASTYARD_SHOTS` when set, otherwise to `test-results/feel/`.
 */

const SHOT_DIR = process.env.BLASTYARD_SHOTS ?? join('test-results', 'feel');
const SCREEN = { width: 1600, height: 720 };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

const arena = {
  open: async (page: Page, query: string) => {
    await page.goto(`/?test&${query}`);
    await page.waitForFunction(() => window.__blastyard?.ready === true);
  },
  advance: (page: Page, n: number) => page.evaluate((t) => window.__blastyard!.advance(t), n),
  fx: (page: Page): Promise<FxStats> => page.evaluate(() => window.__blastyard!.fx()),
  /** Advances one tick at a time until `pred(fx)` holds; returns the ticks taken. */
  until: async (page: Page, pred: (fx: FxStats) => boolean, max: number) => {
    for (let i = 0; i < max; i++) {
      if (pred(await arena.fx(page))) return i;
      await arena.advance(page, 1);
    }
    throw new Error('condition not reached');
  },
};

const game = {
  open: async (page: Page, query = '') => {
    await page.goto(`/?test&game&clock=manual&seed=7&wins=1${query}`);
    await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  },
  advance: (page: Page, n: number) => page.evaluate((t) => window.__blastyardGame!.advance(t), n),
  until: (page: Page, phase: number, max: number) =>
    page.evaluate(([p, m]) => window.__blastyardGame!.advanceUntilPhase(p!, m!), [phase, max]),
  fx: (page: Page) => page.evaluate(() => window.__blastyardGame!.fx()),
  audio: (page: Page) => page.evaluate(() => window.__blastyardGame!.audio()),
};

test.describe('effects at 1600×720', () => {
  test.use({ viewport: SCREEN, deviceScaleFactor: 1 });

  test('explosion chain: particles, debris, shake and flash; screenshots', async ({ page }) => {
    const errors = collectErrors(page);
    await arena.open(page, 'arena=garden&seed=5&scene=chain&pause');
    expect((await arena.fx(page)).particles).toBe(0);
    // First pop of the chain goes off.
    await arena.until(page, (fx) => fx.flash > 0, 40);
    const first = await arena.fx(page);
    expect(first.shake).toBeGreaterThan(0);
    expect(first.shake).toBeLessThanOrEqual(6);
    await arena.advance(page, 3);
    await shot(page, 'chain-1-first-blast.png');
    // Mid-chain: several blasts, crates breaking, particles flying.
    await arena.advance(page, 6);
    const mid = await arena.fx(page);
    expect(mid.particles).toBeGreaterThan(40);
    expect(mid.particles).toBeLessThanOrEqual(300);
    await shot(page, 'chain-2-mid.png');
    await arena.advance(page, 10);
    await shot(page, 'chain-3-end.png');
    // Everything settles: no shake, no flash, no particles left.
    await arena.advance(page, 120);
    const after = await arena.fx(page);
    expect(after).toMatchObject({ particles: 0, flash: 0, shake: 0 });
    expect(errors).toEqual([]);
  });

  test('reduced motion: the same chain without shake or flash, fewer particles', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await arena.open(page, 'arena=garden&seed=5&scene=chain&pause&motion=reduced');
    let maxShake = 0;
    let maxFlash = 0;
    let maxParticles = 0;
    for (let i = 0; i < 60; i++) {
      await arena.advance(page, 1);
      const fx = await arena.fx(page);
      expect(fx.reducedMotion).toBe(true);
      maxShake = Math.max(maxShake, fx.shake);
      maxFlash = Math.max(maxFlash, fx.flash);
      maxParticles = Math.max(maxParticles, fx.particles);
      if (i === 32) await shot(page, 'chain-reduced-motion.png');
    }
    expect(maxShake).toBe(0);
    expect(maxFlash).toBe(0);
    expect(maxParticles).toBeGreaterThan(0);
    expect(maxParticles).toBeLessThanOrEqual(150);
    expect(errors).toEqual([]);
  });

  test('sudden death: blocks fall in from above with a warning marker; screenshots', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await arena.open(page, 'arena=garden&seed=5&scene=suddenDeath&script=idle&pause');
    await arena.until(page, (fx) => fx.drops > 0, 40);
    await arena.advance(page, 5);
    const falling = await arena.fx(page);
    expect(falling.drops).toBeGreaterThan(0);
    // The first block lands on seat 1's corner: it is flattened.
    expect(falling.deaths).toBe(1);
    await shot(page, 'sudden-death-1-first-drop.png');
    await arena.advance(page, 15 * 18);
    await arena.until(page, (fx) => fx.drops === 0, 20);
    await arena.until(page, (fx) => fx.drops > 0, 20);
    await arena.advance(page, 5);
    await shot(page, 'sudden-death-2-closing.png');
    const stats = await page.evaluate(() => window.__blastyard!.stateCounts());
    expect(stats.blocks).toBeGreaterThan(15);
    expect(errors).toEqual([]);
  });

  test('a real match: effects follow the simulation; reduced motion from settings', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await game.open(page);
    await page.getByTestId('start-solo').click();
    await game.until(page, Phase.PLAYING, 400);
    await page.keyboard.press('Space');
    let fx = await game.fx(page);
    for (let i = 0; i < 200 && fx.flash === 0; i++) {
      await game.advance(page, 1);
      fx = await game.fx(page);
    }
    expect(fx.flash).toBeGreaterThan(0);
    expect(fx.shake).toBeGreaterThan(0);
    expect(fx.particles).toBeGreaterThan(0);
    await shot(page, 'solo-blast.png');
    // Switching reduced motion on stops shake and flash immediately.
    await page.evaluate(() => window.__blastyardGame!.setSettings({ reducedMotion: true }));
    await game.advance(page, 1);
    fx = await game.fx(page);
    expect(fx).toMatchObject({ reducedMotion: true, shake: 0, flash: 0 });
    expect(errors).toEqual([]);
  });
});

test.describe('audio', () => {
  test.use({ viewport: SCREEN, deviceScaleFactor: 1 });

  test('no audio before the first user gesture; music and effects after it', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        __audioContexts: number;
      };
      w.__audioContexts = 0;
      const Original = w.AudioContext;
      if (Original) {
        w.AudioContext = class extends Original {
          constructor(options?: AudioContextOptions) {
            super(options);
            w.__audioContexts++;
          }
        };
      }
    });
    await game.open(page);
    // The attract match plays (with blasts) behind the start screen: still no audio at all.
    await game.advance(page, 900);
    const contexts = () =>
      page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts);
    expect(await contexts()).toBe(0);
    expect(await game.audio(page)).toMatchObject({ unlocked: false, contexts: 0, cuesPlayed: 0 });

    // The first tap unlocks it: one context, running, match music.
    await page.getByTestId('start-solo').click();
    expect(await contexts()).toBe(1);
    await expect.poll(async () => (await game.audio(page)).state).toBe('running');
    expect((await game.audio(page)).track).toBe('match');
    await game.until(page, Phase.PLAYING, 400);
    await page.keyboard.press('Space');
    await game.advance(page, 200);
    const after = await game.audio(page);
    expect(after.cuesPlayed).toBeGreaterThan(3);
    expect(await contexts()).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('settings and game speed', () => {
  test.use({ viewport: SCREEN, deviceScaleFactor: 1 });

  for (const lang of ['en', 'hu'] as const) {
    test(`settings panel (${lang}): volumes, speed, vibration, reduced motion persist`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await game.open(page, `&lang=${lang}`);
      await page.getByTestId('open-settings').click();
      await expect(page.getByTestId('settings-screen')).toBeVisible();
      await page.getByTestId('game-speed-85').click();
      await page.getByTestId('haptics-off').click();
      await page.getByTestId('reduced-motion-true').click();
      await page.getByTestId('music-volume').fill('30');
      await shot(page, `settings-${lang}.png`);
      // No text overflows its card.
      const overflow = await page.evaluate(() => {
        const card = document.querySelector('.settings-card')!;
        return card.scrollWidth > card.clientWidth + 1;
      });
      expect(overflow).toBe(false);
      expect(await page.evaluate(() => window.__blastyardGame!.settings())).toMatchObject({
        gameSpeed: 85,
        haptics: 'off',
        reducedMotion: true,
        musicVolume: 0.3,
      });
      await page.getByTestId('settings-back').click();
      await page.getByTestId('start-solo').click();
      expect(await page.evaluate(() => window.__blastyardGame!.speed())).toBe(0.85);
      expect((await game.fx(page)).reducedMotion).toBe(true);
      // Saved: a reload keeps the settings.
      await page.reload();
      await page.waitForFunction(() => window.__blastyardGame?.ready === true);
      expect((await page.evaluate(() => window.__blastyardGame!.settings())).gameSpeed).toBe(85);
      expect(errors).toEqual([]);
    });
  }

  test('game speed 70 % in real time reaches the same state hash as 100 %', async ({ page }) => {
    const errors = collectErrors(page);
    await arena.open(page, 'arena=crossroads&seed=5&speed=0.7');
    await expect
      .poll(() => page.evaluate(() => window.__blastyard!.tick()), { timeout: 20_000 })
      .toBeGreaterThan(300);
    await page.evaluate(() => window.__blastyard!.pause());
    const [tick, hash] = await page.evaluate(() => [
      window.__blastyard!.tick(),
      window.__blastyard!.hash(),
    ]);
    const page2 = await page.context().newPage();
    await arena.open(page2, `arena=crossroads&seed=5&pause&tick=${tick}`);
    expect(await page2.evaluate(() => window.__blastyard!.hash())).toBe(hash);

    // The game shell applies the speed option to its match clock.
    const page3 = await page.context().newPage();
    await page3.goto('/?test&game&clock=manual&speed=70');
    await page3.waitForFunction(() => window.__blastyardGame?.ready === true);
    await page3.getByTestId('start-solo').click();
    expect(await page3.evaluate(() => window.__blastyardGame!.speed())).toBe(0.7);
    expect(errors).toEqual([]);
  });

  test('vibration: on in solo by default, off at the table', async ({ page }) => {
    const errors = collectErrors(page);
    await game.open(page);
    await page.getByTestId('start-solo').click();
    await game.until(page, Phase.PLAYING, 400);
    await page.keyboard.press('Space');
    await game.advance(page, 10);
    expect(await page.evaluate(() => window.__blastyardGame!.haptics())).toContain('light');
    // Escape pauses the match (T5.1); leaving goes through the pause card.
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-leave').click();
    const before = (await page.evaluate(() => window.__blastyardGame!.haptics())).length;
    await page.getByTestId('start-faceoff').click();
    await game.until(page, Phase.PLAYING, 400);
    await page.keyboard.press('Space');
    await game.advance(page, 300);
    expect((await page.evaluate(() => window.__blastyardGame!.haptics())).length).toBe(before);
    expect(errors).toEqual([]);
  });
});
