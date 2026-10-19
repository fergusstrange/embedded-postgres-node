// Copied into an isolated project by check-package.mjs --real. The library is
// loaded only from its installed tarball; pg is supplied by the test harness.
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import * as esm from 'embedded-postgres-node';

const require = createRequire(import.meta.url);
const cjs = require('embedded-postgres-node');
const { Client } = require(process.argv[2]);
const expectedPostgresVersion = process.argv[3];
assert.match(expectedPostgresVersion, /^\d+\.\d+\.\d+$/);
const [major, minor] = expectedPostgresVersion.split('.').map(Number);
const cliCache = resolve('cli-cache');
const cacheDir = resolve('postgres-cache');
const workDir = resolve('work');
await assert.rejects(access(cliCache), { code: 'ENOENT' });
await assert.rejects(access(cacheDir), { code: 'ENOENT' });

for (const [format, entry, offline] of [['ESM', esm, false], ['CommonJS', cjs, true]]) {
  const database = await entry.startPostgres({
    cli: { cacheDir: cliCache, offline },
    cacheDir,
    storage: { type: 'disposable', workDir },
    cliOptions: { offline },
    startTimeoutMs: 240_000,
    startupDeadlineMs: 360_000,
  });
  try {
    const client = new Client({ connectionString: database.connectionUrl });
    try {
      await client.connect();
      assert.equal((await client.query('SELECT 42 AS answer')).rows[0].answer, 42);
      assert.equal(Number((await client.query('SHOW server_version_num')).rows[0].server_version_num), major * 10000 + minor);
      const installs = (await readdir(cacheDir, { withFileTypes: true })).filter(entry => entry.isDirectory());
      assert.equal(installs.length, 1, 'expected one pinned PostgreSQL installation');
      assert.ok(installs[0].name.startsWith(`postgresql-${expectedPostgresVersion}-`), `unexpected default distribution: ${installs[0].name}`);
      if (process.platform === 'win32') assert.ok(installs[0].name.includes('-x86_64-pc-windows-msvc-'), 'shipping Windows selection must use x64 PostgreSQL');
    } finally { await client.end(); }
  } finally { await database.stop(); }
  assert.deepEqual(await database.closed, { exitCode: 0, signal: null, stopped: true });
  assert.deepEqual(await readdir(workDir), []);
  await new Promise((accept, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: database.port });
    socket.once('connect', () => { socket.destroy(); reject(new Error('PostgreSQL port survived teardown')); });
    socket.once('error', accept);
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Port cleanup check timed out')); });
  });
  console.log(`${format}: ${entry.DEFAULT_CLI_RELEASE.version}, PostgreSQL ${expectedPostgresVersion}, ${offline ? 'offline cache reuse' : 'fresh CLI and PostgreSQL downloads'}, SQL and cleanup verified.`);
}
