import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
// Type-only: brings the `window.__blastyardGame` declaration into scope.
import type {} from '../../src/game/shell';

/**
 * T3.3 perf AC: a four-bot match in real time (effects and audio on) on a 4× CPU-throttled
 * Chromium keeps a mean of ≥ 55 FPS. Runs on the project's phone profile (Pixel 7 landscape,
 * DPR 2.625 → renderer resolution 2). Results go to `test-results/perf/perf.json`.
 *
 * Headless Chromium rasterizes WebGL in software (SwiftShader, in the GPU process – CPU
 * throttling does not slow it down), so the frame rate here is fill-rate bound and the automatic
 * quality drop (lower resolution) is part of what is measured. The main-thread cost per frame
 * (simulation, bots, effects, audio scheduling, Pixi scene updates) is asserted separately
 * against the 60 FPS frame budget with a 2× margin.
 */

const THROTTLE = 4;
const WARMUP_MS = 4000;
const MEASURE_MS = 15_000;
const MIN_MEAN_FPS = 55;
/** Half of the 16.7 ms frame budget, at 4× throttle. */
const MAX_MAIN_THREAD_MS = 8.3;

test('4× CPU throttle: a 4-bot round keeps ≥ 55 FPS mean', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test&game&seed=11&wins=3');
  await page.waitForFunction(() => window.__blastyardGame?.ready === true);
  // A tap on the backdrop unlocks audio, like a player would.
  await page.mouse.click(4, 4);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  try {
    await page.evaluate(() => window.__blastyardGame!.startBotMatch());
    await page.waitForTimeout(WARMUP_MS);
    const start = await page.evaluate(() => ({
      frames: window.__blastyardGame!.frames(),
      tick: window.__blastyardGame!.tick(),
      t: performance.now(),
    }));
    // Sample the frame rate once per second (also catches stalls).
    const perSecond: number[] = [];
    let prev = start;
    for (let s = 0; s < MEASURE_MS / 1000; s++) {
      await page.waitForTimeout(1000);
      const now = await page.evaluate(() => ({
        frames: window.__blastyardGame!.frames(),
        tick: window.__blastyardGame!.tick(),
        t: performance.now(),
      }));
      perSecond.push(((now.frames - prev.frames) * 1000) / (now.t - prev.t));
      prev = now;
    }
    const end = prev;
    const meanFps = ((end.frames - start.frames) * 1000) / (end.t - start.t);
    const ticksPerSecond = ((end.tick - start.tick) * 1000) / (end.t - start.t);
    const info = await page.evaluate(() => ({
      quality: window.__blastyardGame!.quality(),
      resolution: window.__blastyardGame!.resolution(),
      mainThreadMsPerFrame: Math.round(window.__blastyardGame!.frameWorkMs() * 100) / 100,
      screen: window.__blastyardGame!.screen(),
      phase: window.__blastyardGame!.phase(),
      audio: window.__blastyardGame!.audio(),
      fx: window.__blastyardGame!.fx(),
      dpr: window.devicePixelRatio,
      viewport: { w: innerWidth, h: innerHeight },
    }));
    const report = {
      throttle: THROTTLE,
      meanFps: Math.round(meanFps * 10) / 10,
      minSecondFps: Math.round(Math.min(...perSecond) * 10) / 10,
      perSecond: perSecond.map((v) => Math.round(v * 10) / 10),
      ticksPerSecond: Math.round(ticksPerSecond * 10) / 10,
      ...info,
    };
    mkdirSync(join('test-results', 'perf'), { recursive: true });
    writeFileSync(join('test-results', 'perf', 'perf.json'), JSON.stringify(report, null, 2));
    console.log(`perf: ${JSON.stringify(report)}`);
    expect(info.screen).toBe('playing');
    expect(info.audio.unlocked).toBe(true);
    expect(meanFps).toBeGreaterThanOrEqual(MIN_MEAN_FPS);
    expect(info.mainThreadMsPerFrame).toBeLessThanOrEqual(MAX_MAIN_THREAD_MS);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  expect(errors).toEqual([]);
});
