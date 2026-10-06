import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Browser / host globals that pure, deterministic core logic must never touch. */
const CORE_FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'HTMLElement',
  'HTMLCanvasElement',
  'Image',
  'fetch',
];

/** Core functions that write to a `SimState`; the render layer must not import them. */
const CORE_MUTATORS = [
  'step',
  'restore',
  'addBomb',
  'removeBomb',
  'applyPickup',
  'movePlayer',
  'fillArena',
  'seedAllStreams',
  'seedStream',
  'nextU32',
  'randInt',
  'randPercent',
  'randWeighted',
  'runReplay',
];

/** Project convention: named exports only (see CLAUDE.md). */
const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports.',
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'sourcemaps',
      'android',
      'ios',
      'coverage',
      'test-results',
      'playwright-report',
      'node_modules',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT],
    },
  },
  {
    // Native APIs are only reachable through the platform layer.
    ignores: ['src/platform/**', 'capacitor.config.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@capacitor/*', '@revenuecat/*'],
              message: 'Import native APIs via src/platform instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/core is pure and deterministic (see CLAUDE.md). Mirrored by tests/unit/corePurity.test.ts.
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...CORE_FORBIDDEN_GLOBALS.map((name) => ({
          name,
          message: 'src/core must not use DOM / host APIs.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG from src/core/rng.ts.' },
        { object: 'Date', property: 'now', message: 'Core logic must be deterministic.' },
        { object: 'performance', property: 'now', message: 'Core logic must be deterministic.' },
      ],
      'no-restricted-syntax': [
        'error',
        NO_DEFAULT_EXPORT,
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Core logic must not read the clock; pass time in as data.',
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: 'Core logic must not read the clock; pass time in as data.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'pixi.js',
                'pixi.js/*',
                '@pixi/*',
                'preact',
                'preact/*',
                '@capacitor/*',
                '@revenuecat/*',
              ],
              message: 'src/core must not depend on rendering, UI or native layers.',
            },
            {
              regex: '^(\\.\\./)+(game|render|input|audio|ui|platform|i18n|content|net)(/|$)',
              message: 'src/core must not import from outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/render only reads core state (CLAUDE.md). Mirrored by tests/unit/render/readOnly.test.ts;
    // the renderer also only sees the state as `ReadonlySimState` (type-level guard).
    files: ['src/render/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@capacitor/*', '@revenuecat/*'],
              message: 'Import native APIs via src/platform instead.',
            },
            {
              regex: '^(\\.\\./)+core/',
              message: 'Import the core through its public index (../core).',
            },
            {
              regex: '^(\\.\\./)+core$',
              importNames: CORE_MUTATORS,
              message: 'src/render must never mutate core state.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
