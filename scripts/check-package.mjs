import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const npm = (...args) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8' });
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
mkdirSync('.local', { recursive: true });
const [tarball] = JSON.parse(npm('pack', '--json', '--ignore-scripts', '--pack-destination', '.local'));
const files = tarball.files.map(file => file.path);
for (const file of files) {
  assert.match(file, /^(dist\/|docs\/|examples\/|README\.md$|LICENSE$|package\.json$)/);
  assert.doesNotMatch(file, /node_modules|\.local|\.tgz$|\.env/);
}
for (const path of ['dist/esm/index.js', 'dist/esm/index.d.ts', 'dist/cjs/index.js', 'dist/cjs/index.d.ts', 'dist/cjs/package.json', 'README.md', 'LICENSE']) assert.ok(files.includes(path), `missing ${path}`);
const metadata = JSON.parse(readFileSync('package.json'));
assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
assert.ok(tarball.unpackedSize < 1_000_000, 'unexpected package bloat');
const temporary = mkdtempSync(join(tmpdir(), 'ep-node-package-'));
try {
  writeFileSync(join(temporary, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', resolve('.local', tarball.filename)], { cwd: temporary, stdio: 'pipe' });
  const smoke = `
    const assert = require('node:assert/strict');
    const before = process.listenerCount('SIGTERM');
    const pkg = require('embedded-postgres-node');
    assert.equal(process.listenerCount('SIGTERM'), before);
    assert.equal(typeof pkg.withPostgres, 'function');
    (async () => {
      const esm = await import('embedded-postgres-node');
      assert.equal(typeof esm.resolveCli, 'function');
      for (const entry of [pkg, esm]) {
        const database = await entry.startPostgres(${JSON.stringify({ cli: { path: process.execPath }, env: { NODE_OPTIONS: `--import ${JSON.stringify(resolve('test/fixtures/cli.mjs'))}` } })});
        await database.stop();
        assert.equal((await database.closed).stopped, true);
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  execFileSync(process.execPath, ['-e', smoke], { cwd: temporary, stdio: 'inherit' });
  const consumer = `
    import { startPostgres, withPostgres, resolveCli, DEFAULT_CLI_RELEASE, type PostgresInstance, type PostgresOptions, type CliRelease } from 'embedded-postgres-node';
    const release: Readonly<CliRelease> = DEFAULT_CLI_RELEASE;
    const options: PostgresOptions = { cli: { cacheDir: './cli-cache', offline: true }, storage: { type: 'disposable' }, parameters: { max_connections: '10' } };
    async function use(): Promise<number> {
      const db: PostgresInstance = await startPostgres(options);
      await db[Symbol.asyncDispose]();
      return withPostgres(options, async db => db.port);
    }
    // @ts-expect-error ports are numeric
    startPostgres({ port: '5432' });
    // @ts-expect-error persistent storage needs an explicit data directory
    startPostgres({ storage: { type: 'persistent' } });
    // @ts-expect-error default release metadata is readonly
    DEFAULT_CLI_RELEASE.version = 'v2.0.0';
    // @ts-expect-error default checksums are readonly
    DEFAULT_CLI_RELEASE.checksums['linux-amd64'] = 'untrusted';
    void resolveCli({ release });
    void use;
  `;
  for (const extension of ['mts', 'cts']) writeFileSync(join(temporary, `consumer.${extension}`), consumer);
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,ESNext.Disposable', '--typeRoots', resolve('node_modules/@types'), '--types', 'node', join(temporary, 'consumer.mts'), join(temporary, 'consumer.cts')], { cwd: temporary, stdio: 'inherit' });
  console.log(`Verified ${tarball.filename}: ${files.length} files, ESM/CommonJS lifecycle and TypeScript consumers, zero runtime dependencies.`);
  if (process.argv.includes('--real')) {
    copyFileSync('test/fixtures/released-consumer.mjs', join(temporary, 'released-consumer.mjs'));
    execFileSync(process.execPath, ['released-consumer.mjs', resolve('node_modules/pg')], { cwd: temporary, stdio: 'inherit', timeout: 600_000 });
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
