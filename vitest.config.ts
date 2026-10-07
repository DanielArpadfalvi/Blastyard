import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Keep the owner's local machine responsive: 2 workers locally, default in CI.
    maxWorkers: process.env.CI ? undefined : 2,
    // Perf assertions (sim bench) are skipped under coverage instrumentation.
    env: { BLASTYARD_COVERAGE: process.argv.includes('--coverage') ? '1' : '' },
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
