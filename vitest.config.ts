import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Perf assertions (sim bench) are skipped under coverage instrumentation.
    env: { BLASTYARD_COVERAGE: process.argv.includes('--coverage') ? '1' : '' },
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
