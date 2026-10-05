import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection, createServer } from 'node:net';
import pg from 'pg';
import { startPostgres, withPostgres } from '../../dist/esm/index.js';

const cli = process.env.EMBEDDED_POSTGRES_CLI;
if (!cli) throw new Error('Integration tests require EMBEDDED_POSTGRES_CLI; build the Go CLI first.');
const base = {
  cli: { path: cli },
  ...(process.env.EP_TEST_BINARIES ? { binaries: process.env.EP_TEST_BINARIES } : {}),
  ...(process.env.EP_TEST_VERSION ? { postgresVersion: process.env.EP_TEST_VERSION } : {}),
};
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ep-node-real-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function query(instance, sql) {
  const client = new pg.Client({ connectionString: instance.connectionUrl });
  try { await client.connect(); return await client.query(sql); }
  finally { await client.end(); }
}
async function listening(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.setTimeout(200, () => { socket.destroy(); resolve(false); });
  });
}
async function eventually(predicate, description) {
  const limit = Date.now() + 20000;
  while (Date.now() < limit) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail(description);
}

test('real SQL, concurrent isolation, dynamic ports and disposable directory cleanup', { timeout: 120000 }, async t => {
  const workDir = await temporary(t);
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => startPostgres({ ...base, storage: { type: 'disposable', workDir }, parameters: { max_connections: '20' } })));
  const instances = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  t.after(() => Promise.all(instances.map(p => p.stop())));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  assert.notEqual(instances[0].port, instances[1].port);
  assert.equal((await query(instances[0], 'SELECT 42 AS answer')).rows[0].answer, 42);
  await query(instances[0], 'CREATE TABLE isolated (id int)');
  assert.equal((await query(instances[1], "SELECT to_regclass('isolated') AS table_name")).rows[0].table_name, null);
  await Promise.all(instances.map(p => p.stop()));
  assert.deepEqual(await readdir(workDir), []);
  for (const instance of instances) assert.equal(await listening(instance.port), false);
});
test('persistent clusters preserve data and restart with explicit credentials', { timeout: 120000 }, async t => {
  const directory = await temporary(t);
  const options = { ...base, database: 'persistent_test', username: 'tester', password: 'explicit-test-password', storage: { type: 'persistent', dataDir: join(directory, 'data'), workDir: directory } };
  await withPostgres(options, async instance => { await query(instance, 'CREATE TABLE durable (id int); INSERT INTO durable VALUES (7)'); });
  assert.ok((await stat(options.storage.dataDir)).isDirectory());
  await withPostgres(options, async instance => { assert.equal((await query(instance, 'SELECT id FROM durable')).rows[0].id, 7); });
  assert.deepEqual((await readdir(directory)).sort(), ['data', 'data.embedded-postgres.lock']);
});
test('startup errors leave disposable workspaces empty and diagnostics safe', { timeout: 120000 }, async t => {
  const workDir = await temporary(t);
  await assert.rejects(startPostgres({ ...base, password: 'failure-secret', storage: { type: 'disposable', workDir }, parameters: { nonexistent_test_setting: '1' } }), error => {
    assert.equal(error.code, 'STARTUP');
    assert.doesNotMatch(error.message + error.stderr, /failure-secret|postgresql:\/\//);
    return true;
  });
  assert.deepEqual(await readdir(workDir), []);
});
test('occupied port failure cleans up without touching the existing listener', { timeout: 120000 }, async t => {
  const workDir = await temporary(t);
  const server = createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(startPostgres({ ...base, port, startTimeoutMs: 3000, storage: { type: 'disposable', workDir } }), { code: 'STARTUP' });
  assert.equal(await listening(port), true);
  assert.deepEqual(await readdir(workDir), []);
});
test('runtime abort completes real database cleanup', { timeout: 120000 }, async t => {
  const workDir = await temporary(t);
  const controller = new AbortController();
  const instance = await startPostgres({ ...base, storage: { type: 'disposable', workDir }, signal: controller.signal });
  controller.abort();
  const result = await instance.closed;
  assert.equal(result.error.code, 'ABORTED');
  assert.equal(result.stopped, true);
  assert.equal(result.exitCode, 0);
  assert.equal(await listening(instance.port), false);
  assert.deepEqual(await readdir(workDir), []);
});
for (const mode of ['exit', 'kill']) test(`Node parent ${mode} closes ownership pipe and cleans real database`, { timeout: 120000 }, async t => {
  const workDir = await temporary(t);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/parent.mjs', import.meta.url))], {
    env: { ...process.env, PARENT_OPTIONS: JSON.stringify({ ...base, storage: { type: 'disposable', workDir } }) },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  const message = await Promise.race([
    once(child, 'message').then(([value]) => value),
    exited.then(() => { throw new Error('Parent fixture exited before readiness'); }),
  ]);
  assert.equal(message.ready, true);
  assert.equal(await listening(message.port), true);
  if (mode === 'kill') child.kill('SIGKILL');
  else child.send('exit');
  await exited;
  await eventually(async () => !(await listening(message.port)) && (await readdir(workDir)).length === 0, 'PostgreSQL and disposable workspace survived Node parent death');
});
test('scoped migration failure still removes the real cluster', { timeout: 120000 }, async t => {
  const workDir = await temporary(t);
  await assert.rejects(withPostgres({ ...base, storage: { type: 'disposable', workDir } }, async instance => {
    await query(instance, 'CREATE TABLE example (id int)');
    throw new Error('migration fixture failure');
  }), /migration fixture failure/);
  assert.deepEqual(await readdir(workDir), []);
});
