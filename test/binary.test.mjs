import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliPlatform, resolveCli, DEFAULT_CLI_RELEASE } from '../dist/esm/index.js';
import { cliAsset } from '../dist/esm/binary.js';

const payload = Buffer.from('verified binary fixture');
const sha = createHash('sha256').update(payload).digest('hex');
const target = cliPlatform();
async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), 'ep-node-download-'));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (handler) handler(req, res);
    else res.end(payload);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { requests, root, source: { cacheDir: root, release: { version: 'v2.0.0-alpha.1', checksums: { [target]: sha }, baseUrl: `http://127.0.0.1:${server.address().port}/releases` } } };
}
test('all six platform/asset mappings', () => {
  for (const [os, mapped] of [['linux','linux'],['darwin','darwin'],['win32','windows']]) {
    for (const [arch, cpu] of [['x64','amd64'],['arm64','arm64']]) {
      assert.equal(cliPlatform(os, arch), `${mapped}-${cpu}`);
      assert.equal(cliAsset(cliPlatform(os, arch)), `embedded-postgres_${mapped}_${cpu}${os === 'win32' ? '.exe' : ''}`);
    }
  }
  assert.throws(() => cliPlatform('freebsd', 'x64'), { code: 'BINARY' });
  assert.throws(() => cliPlatform('linux', 'ia32'), { code: 'BINARY' });
});
test('local paths, explicit source precedence, env fallback and abort', async () => {
  const previous = process.env.EMBEDDED_POSTGRES_CLI;
  delete process.env.EMBEDDED_POSTGRES_CLI;
  try {
    for (const path of ['', 'bad\0']) await assert.rejects(resolveCli({ path }), { code: 'CONFIG' });
    await assert.rejects(resolveCli({ path: '/no/such/cli' }), { code: 'BINARY' });
    process.env.EMBEDDED_POSTGRES_CLI = process.execPath;
    assert.equal(await resolveCli(), process.execPath);
    process.env.EMBEDDED_POSTGRES_CLI = '/no/such/env-cli';
    assert.equal(await resolveCli({ path: process.execPath }), process.execPath);
    await assert.rejects(resolveCli(), { code: 'BINARY' });
    await assert.rejects(resolveCli(undefined, AbortSignal.abort()), { code: 'ABORTED' });
  } finally {
    if (previous === undefined) delete process.env.EMBEDDED_POSTGRES_CLI;
    else process.env.EMBEDDED_POSTGRES_CLI = previous;
  }
});
test('default release rejects untrusted bytes and supports offline cache selection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ep-node-default-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    return new Response(payload);
  });
  await assert.rejects(resolveCli({ cacheDir: root, offline: true }), /offline cache/);
  assert.equal(requests.length, 0);
  await assert.rejects(resolveCli({ cacheDir: root }), /checksum mismatch/);
  assert.deepEqual(requests, [`https://github.com/fergusstrange/embedded-postgres/releases/download/v2.0.0-alpha.1/${cliAsset(target)}`]);
  assert.ok(!(await readdir(root, { recursive: true })).some(x => x.endsWith('.tmp') || x.endsWith(cliAsset(target))));
  // Exported metadata must not allow another importer to change the trusted default.
  assert.throws(() => { DEFAULT_CLI_RELEASE.version = 'v2.99.0'; }, TypeError);
  assert.throws(() => { DEFAULT_CLI_RELEASE.checksums[target] = sha; }, TypeError);
});
test('download, checksum, offline reuse, corruption recovery and no temporary files', async t => {
  const { requests, source, root } = await fixture(t);
  const path = await resolveCli(source);
  assert.deepEqual(await readFile(path), payload);
  assert.deepEqual(requests, [`/releases/v2.0.0-alpha.1/${cliAsset(target)}`]);
  assert.equal(await resolveCli({ ...source, offline: true }), path);
  await writeFile(path, 'corruption');
  await assert.rejects(resolveCli({ ...source, offline: true }), { code: 'BINARY' });
  assert.equal(await resolveCli(source), path);
  assert.equal(requests.length, 2);
  const files = await readdir(root, { recursive: true });
  assert.ok(!files.some(x => x.endsWith('.tmp')));
});
test('concurrent cache installation returns identical verified bytes', async t => {
  const { source } = await fixture(t);
  const paths = await Promise.all(Array.from({ length: 8 }, () => resolveCli(source)));
  assert.ok(paths.every(path => path === paths[0]));
  assert.deepEqual(await readFile(paths[0]), payload);
});
test('checksum mismatch never installs binary', async t => {
  const { source, root } = await fixture(t, (_req, res) => res.end('tampered'));
  await assert.rejects(resolveCli(source), /checksum mismatch/);
  assert.ok(!(await readdir(root, { recursive: true })).some(x => x.endsWith('.tmp') || x.endsWith(cliAsset(target))));
});
for (const [name, handler, pattern] of [
  ['missing release', (_req, res) => { res.writeHead(404); res.end('missing'); }, /HTTP 404/],
  ['size header', (_req, res) => { res.writeHead(200, { 'content-length': 128 * 1024 * 1024 + 1 }); res.end(); }, /128 MiB/],
  ['disconnect', (_req, res) => { res.writeHead(200); res.write('partial'); res.destroy(); }, /network and cache/],
]) test(name, async t => {
  const { source } = await fixture(t, handler);
  await assert.rejects(resolveCli(source), pattern);
});
test('bounded streamed download even without content-length', async t => {
  const { source } = await fixture(t, async (_req, res) => {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 130 && !res.destroyed; i++) {
      if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
    }
    res.end();
  });
  await assert.rejects(resolveCli(source), /128 MiB/);
});
test('download cancellation and timeout leave cache clean', async t => {
  const { source, root } = await fixture(t, (_req, res) => { res.writeHead(200); res.write('partial'); });
  const abort = new AbortController();
  const result = resolveCli(source, abort.signal);
  setTimeout(() => abort.abort(), 40);
  await assert.rejects(result, { code: 'ABORTED' });
  await assert.rejects(resolveCli({ ...source, downloadTimeoutMs: 40 }), { code: 'TIMEOUT' });
  assert.ok(!(await readdir(root, { recursive: true })).some(x => x.endsWith('.tmp')));
});
test('configuration validates exact tags, pins and download URLs', async t => {
  const { source } = await fixture(t);
  for (const release of [
    { ...source.release, version: 'latest' }, { ...source.release, version: '../../escape' },
    { ...source.release, checksums: {} }, { ...source.release, checksums: { [target]: 'wrong' } },
    ...['oops', 'http://example.com/', 'https://u:p@example.com/', 'https://example.com/?secret=1', 'https://example.com/#hash'].map(baseUrl => ({ ...source.release, baseUrl })),
  ]) await assert.rejects(resolveCli({ ...source, release }), { code: 'CONFIG' });
  await assert.rejects(resolveCli({ ...source, downloadTimeoutMs: 0 }), { code: 'CONFIG' });
});
test('cache filesystem errors are actionable and do not leak paths or causes', async t => {
  const { source, root } = await fixture(t);
  await writeFile(join(root, 'not-directory'), 'x');
  await assert.rejects(resolveCli({ ...source, cacheDir: join(root, 'not-directory') }), error => {
    assert.equal(error.code, 'BINARY');
    assert.doesNotMatch(error.message, /not-directory/);
    assert.equal(error.cause, undefined);
    return true;
  });
  const destination = join(root, source.release.version, sha, cliAsset(target));
  await mkdir(destination, { recursive: true });
  await assert.rejects(resolveCli(source), { code: 'BINARY' });
});
test('release CDN redirects support signed query strings', async t => {
  const { source, requests } = await fixture(t, (req, res) => {
    if (!req.url.startsWith('/asset')) { res.writeHead(302, { location: '/asset?signature=fixture' }); res.end(); }
    else res.end(payload);
  });
  await resolveCli(source);
  assert.equal(requests[1], '/asset?signature=fixture');
});
for (const [location, pattern] of [[undefined, /no location/], ['/loop', /too many redirects/], ['http://example.invalid/plain', /require HTTPS/]]) {
  test(`unsafe/broken redirect: ${location}`, async t => {
    const { source } = await fixture(t, (_req, res) => { res.writeHead(302, location ? { location } : {}); res.end(); });
    await assert.rejects(resolveCli(source), pattern);
  });
}
