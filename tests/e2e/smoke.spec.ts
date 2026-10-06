import { expect, test } from '@playwright/test';

test('page loads with a full-viewport canvas and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Blastyard');

  const canvas = page.getByTestId('stage-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('ui-root')).toBeAttached();

  // Landscape viewport, canvas fills it (CSS pixels) and the backing store is DPR-scaled.
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(viewport!.width).toBeGreaterThan(viewport!.height);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(viewport!.width);
  expect(Math.round(box!.height)).toBe(viewport!.height);
  const { backing, dpr } = await canvas.evaluate((el: HTMLCanvasElement) => ({
    backing: el.width,
    dpr: window.devicePixelRatio,
  }));
  expect(backing).toBe(Math.round(viewport!.width * Math.min(dpr, 2)));

  // The portrait hint stays hidden in landscape.
  await expect(page.getByRole('status')).toBeHidden();

  expect(errors).toEqual([]);
});
