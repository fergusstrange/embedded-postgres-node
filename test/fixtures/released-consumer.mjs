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
  console.log(`${format}: ${entry.DEFAULT_CLI_RELEASE.version}, ${offline ? 'offline cache reuse' : 'fresh CLI and PostgreSQL downloads'}, SQL and cleanup verified.`);
}
