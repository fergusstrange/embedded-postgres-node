import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { startPostgres, withPostgres, PostgresError } from '../dist/esm/index.js';
import { fakeOptions } from './helpers.mjs';

test('readiness, split UTF-8, explicit lifetime, hidden credentials and idempotent stop', async () => {
  const before = process.listenerCount('SIGTERM');
  const pg = await startPostgres(fakeOptions('split'));
  assert.equal(pg.port, 54321);
  assert.match(pg.connectionUrl, /^postgresql:/);
  assert.doesNotMatch(inspect(pg), /postgresql:/);
  assert.deepEqual(JSON.parse(JSON.stringify(pg)), { port: 54321 });
  assert.equal(process.listenerCount('SIGTERM'), before);
  const a = pg.stop();
  const b = pg.stop();
  assert.equal(a, b);
  await a;
  await pg[Symbol.asyncDispose]();
  assert.deepEqual(await pg.closed, { exitCode: 0, signal: null, stopped: true });
});

test('password stays in child environment, reserved ambient environment is removed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ep-node-options-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const argsFile = join(dir, 'args.json');
  const pg = await startPostgres(fakeOptions('normal', { password: 'sensitive!', env: { ARGS_FILE: argsFile } }));
  await pg.stop();
  const data = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.equal(basename(data.args[1]), 'run');
  assert.deepEqual(data.ep, ['EP_PASSWORD']);
  assert.ok(!data.args.join(' ').includes('sensitive!'));
});

for (const [mode, code] of [['invalid-json','PROTOCOL'],['protocol','PROTOCOL'],['oversized','PROTOCOL'],['stopped-first','PROTOCOL'],['early-exit','EXIT'],['error','STARTUP']]) {
  test(`startup failure ${mode} waits for cleanup and reports safe diagnostics`, async () => {
    await assert.rejects(startPostgres(fakeOptions(mode, { password: 'very secret!' })), error => {
      assert.ok(error instanceof PostgresError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message + error.stderr, /very secret!|very%20secret|postgresql:\/\//);
      if (mode === 'error') assert.match(error.stderr, /redacted/);
      return true;
    });
  });
}
for (const [mode, code] of [['no-stopped','EXIT'], ['nonzero-stop','EXIT'], ['duplicate','PROTOCOL'], ['runtime-error','EXIT'], ['ready-exit','EXIT'], ['shutdown-error','EXIT'], ['duplicate-stop','EXIT'], ['stdout-end','EXIT']]) {
  test(`post-ready failure ${mode} is available through closed and stop`, async () => {
    const pg = await startPostgres(fakeOptions(mode));
    if (['runtime-error','ready-exit','duplicate','duplicate-stop','stdout-end'].includes(mode)) await pg.closed;
    await assert.rejects(pg.stop(), { code });
    assert.equal((await pg.closed).error.code, code);
  });
}

test('outer startup deadline initiates cleanup', async () => {
  await assert.rejects(startPostgres(fakeOptions('never-ready', { startupDeadlineMs: 200 })), { code: 'TIMEOUT' });
});
test('lifetime cancellation before spawn, during startup and after readiness', async () => {
  const pre = AbortSignal.abort();
  await assert.rejects(startPostgres(fakeOptions('normal', { signal: pre })), { code: 'ABORTED' });
  const startup = new AbortController();
  const promise = startPostgres(fakeOptions('never-ready', { signal: startup.signal }));
  setTimeout(() => startup.abort('do not leak this reason'), 100);
  await assert.rejects(promise, { code: 'ABORTED' });
  const active = new AbortController();
  const pg = await startPostgres(fakeOptions('normal', { signal: active.signal }));
  active.abort();
  assert.equal((await pg.closed).error.code, 'ABORTED');
  await assert.rejects(pg.stop(), { code: 'ABORTED' });
});

test('shutdown preserves grace period and waits for stopped plus exit', async () => {
  const pg = await startPostgres(fakeOptions('slow-stop'));
  const start = performance.now();
  await pg.stop();
  assert.ok(performance.now() - start >= 150);
});
test('stalled CLI is killed only after outer shutdown deadline', async () => {
  const pg = await startPostgres(fakeOptions('hang'));
  const start = performance.now();
  await assert.rejects(pg.stop(), { code: 'SHUTDOWN' });
  assert.ok(performance.now() - start >= 2000);
  assert.equal((await pg.closed).stopped, false);
});
test('final protocol line without newline', async () => {
  const pg = await startPostgres(fakeOptions('final-line'));
  await pg.stop();
});
for (const mode of ['flood', 'long-stderr']) test(`bounded stderr diagnostics (${mode}) are redacted`, async () => {
  const pg = await startPostgres(fakeOptions(mode, { password: 'secret-secret' }));
  const result = await pg.closed;
  assert.equal(result.error.code, 'EXIT');
  assert.ok(result.error.stderr.length <= 65536);
  assert.doesNotMatch(result.error.stderr, /secret-secret|postgresql:\/\//);
  assert.match(result.error.stderr, /redacted/);
  await assert.rejects(pg.stop(), { code: 'EXIT' });
});
test('scoped helper returns result and preserves callback or combined failure', async () => {
  assert.equal(await withPostgres(fakeOptions(), async pg => pg.port), 54321);
  const error = new Error('migration failed');
  await assert.rejects(withPostgres(fakeOptions(), async () => { throw error; }), e => e === error);
  await assert.rejects(withPostgres(fakeOptions('shutdown-error'), async () => 1), { code: 'EXIT' });
  await assert.rejects(withPostgres(fakeOptions('shutdown-error'), async () => { throw error; }), e => {
    assert.ok(e instanceof AggregateError);
    assert.equal(e.errors[0], error);
    assert.equal(e.errors[1].code, 'EXIT');
    return true;
  });
});
test('missing executable fails clearly', async () => {
  await assert.rejects(startPostgres({ cli: { path: '/definitely/not/a/cli' } }), { code: 'BINARY' });
});
test('an executable directory produces a handled spawn error', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ep-node-spawn-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(startPostgres({ cli: { path: dir } }), { code: 'SPAWN' });
});
test('outer startup deadline covers downloads', async t => {
  const { createServer } = await import('node:http');
  const { cliPlatform } = await import('../dist/esm/index.js');
  const server = createServer((_req, res) => { res.writeHead(200); res.write('incomplete'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(join(tmpdir(), 'ep-node-startup-'));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  await assert.rejects(startPostgres({ startupDeadlineMs: 100, cli: { cacheDir: dir, release: { version: 'v2.0.0', checksums: { [cliPlatform()]: '0'.repeat(64) }, baseUrl: `http://127.0.0.1:${server.address().port}/` } } }), { code: 'TIMEOUT' });
});
test('cancellation cannot hide an unconfirmed forced shutdown', async () => {
  const controller = new AbortController();
  const pg = await startPostgres(fakeOptions('hang', { signal: controller.signal }));
  controller.abort();
  const result = await pg.closed;
  assert.equal(result.error.code, 'SHUTDOWN');
  assert.match(result.error.message, /aborted.*cleanup cannot be confirmed/);
  await assert.rejects(pg.stop(), { code: 'SHUTDOWN' });
});
