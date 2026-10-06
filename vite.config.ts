import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/** Source maps go here, outside `dist` (the Capacitor web dir), so they never ship in the app. */
const SOURCEMAP_DIR = 'sourcemaps';

/**
 * With `sourcemap: 'hidden'` the bundles carry no `sourceMappingURL` comment; this moves the
 * `.map` files out of the output so `cap copy` / the store builds don't include them, while
 * keeping them locally for symbolicating crash reports.
 */
function sourcemapsOutsideDist(): Plugin {
  return {
    name: 'blastyard:sourcemaps-outside-dist',
    apply: 'build',
    generateBundle(_options, bundle) {
      rmSync(SOURCEMAP_DIR, { recursive: true, force: true });
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !name.endsWith('.map')) continue;
        const out = join(SOURCEMAP_DIR, name);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, file.source);
        delete bundle[name];
      }
    },
  };
}

export default defineConfig({
  plugins: [preact(), sourcemapsOutsideDist()],
  base: './',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
  },
});
