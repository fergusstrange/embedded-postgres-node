import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
rmSync('dist', { recursive: true, force: true });
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
const staging = '.local/build';
mkdirSync(staging, { recursive: true });
try {
  cpSync('src', `${staging}/src`, { recursive: true });
  writeFileSync(`${staging}/package.json`, '{"type":"commonjs"}\n');
  writeFileSync(`${staging}/tsconfig.json`, JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { rootDir: './src', outDir: '../../dist/cjs', verbatimModuleSyntax: false },
    include: ['./src/**/*.ts'],
  }));
  execFileSync(process.execPath, [tsc, '-p', resolve(staging, 'tsconfig.json')], { stdio: 'inherit' });
  writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
} finally { rmSync(staging, { recursive: true, force: true }); }
