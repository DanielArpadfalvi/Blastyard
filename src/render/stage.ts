import { Application } from 'pixi.js';
import { renderResolution } from './resolution';

/** Backyard-lawn backdrop until the arena renderer (T2.1) draws over it. */
export const STAGE_BACKGROUND = 0x1b2a1e;

/**
 * Creates the gameplay canvas: fills `host` (and follows its size), DPR-aware with CSS-pixel
 * coordinates (`autoDensity`), so layout code works in CSS pixels on every device.
 */
export async function createStage(host: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    resolution: renderResolution(globalThis.devicePixelRatio ?? 1),
    autoDensity: true,
    antialias: true,
    background: STAGE_BACKGROUND,
    preference: 'webgl',
  });
  app.canvas.setAttribute('data-testid', 'stage-canvas');
  host.appendChild(app.canvas);
  return app;
}
