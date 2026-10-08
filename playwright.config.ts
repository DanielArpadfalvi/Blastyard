import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

/** Override with PW_PORT to run several e2e suites side by side. */
const PORT = Number(process.env.PW_PORT ?? 4173);

/**
 * The cloud dev container ships a preinstalled Chromium under PLAYWRIGHT_BROWSERS_PATH
 * (/opt/pw-browsers) whose build may not match the installed @playwright/test version.
 * If Playwright's expected binary is missing, fall back to the preinstalled one (only if it
 * exists). In CI, `npx playwright install` provides the matching build, so this is a no-op there.
 */
function resolveChromiumExecutable(): string | undefined {
  if (existsSync(chromium.executablePath())) return undefined;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const candidate = join(root, 'chromium');
  return existsSync(candidate) ? candidate : undefined;
}

const executablePath = resolveChromiumExecutable();

const PERF = /perf\.spec\.ts/;
/** Specs that render in real time at large sizes (see the `heavy` project). */
const HEAVY = /(feel|spike|render|online)\.spec\.ts/;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  // Keep the owner's local machine responsive: 2 workers locally, runner default in CI.
  workers: process.env.CI ? undefined : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The runner renders WebGL in software (SwiftShader) on 4 vCPUs: the tick-by-tick effect and
  // arena-view flows at 1600×720+ take 3–5× as long as locally (~20 s here) and ran out of 30 s.
  timeout: process.env.CI ? 120_000 : 30_000,
  // CI: 'github' turns failures into run annotations (readable without log access).
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Landscape-only game: a phone held sideways or laid flat on the table.
      name: 'landscape-chromium',
      testIgnore: [PERF, HEAVY],
      use: {
        ...devices['Pixel 7 landscape'],
        browserName: 'chromium',
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    {
      // Real-time render / effect flows at large viewports: under software WebGL they need the
      // CPU to themselves (next to the other specs they ran out of time or crashed the renderer).
      name: 'heavy',
      testMatch: HEAVY,
      dependencies: ['landscape-chromium'],
      use: {
        ...devices['Pixel 7 landscape'],
        browserName: 'chromium',
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    {
      // Frame-rate measurement (T3.3): runs after the other tests so nothing competes for the CPU.
      name: 'perf',
      testMatch: PERF,
      dependencies: ['heavy'],
      use: {
        ...devices['Pixel 7 landscape'],
        browserName: 'chromium',
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
