import { execFileSync } from 'node:child_process';
if (!process.env.EMBEDDED_POSTGRES_CLI) throw new Error('Set EMBEDDED_POSTGRES_CLI before running examples');
for (const args of [
  ['--test', 'examples/node-test.mjs'],
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'examples/vitest.config.mjs'],
  ['node_modules/jest/bin/jest.js', '--config', 'examples/jest.config.cjs', '--runInBand'],
  ['examples/scoped.mjs'],
  ['examples/migrations.mjs'],
]) execFileSync(process.execPath, args, { stdio: 'inherit', timeout: 180000 });
