// Runs a TypeScript script through Vite's module runner (resolves the project's extensionless
// TS imports without a build step) and calls its exported `main(args)`; the returned number is
// the exit code. Usage: node scripts/run-ts.mjs scripts/sim-bench.ts [args…]
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [file, ...args] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/run-ts.mjs <script.ts> [args…]');
  process.exit(2);
}
const { module } = await runnerImport(resolve(file), { configFile: false, logLevel: 'error' });
if (typeof module.main !== 'function') {
  console.error(`${file} has no exported main(args)`);
  process.exit(2);
}
process.exitCode = (await module.main(args)) ?? 0;
