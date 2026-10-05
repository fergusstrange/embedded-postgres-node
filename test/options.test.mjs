import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOptions } from '../dist/esm/options.js';
import { PostgresError, positiveTimeout, redact } from '../dist/esm/errors.js';

test('defaults isolate ambient EP configuration and never put credentials in argv', () => {
  process.env.EP_DATA_DIR = '/never/use';
  process.env.EP_CONFIG = '/never/read';
  try {
    const options = prepareOptions({});
    assert.ok(options.args.includes('--port=0'));
    assert.equal(options.env.EP_DATA_DIR, undefined);
    assert.equal(options.env.EP_CONFIG, undefined);
    assert.equal(options.password.length, 32);
    assert.equal(options.env.EP_PASSWORD, options.password);
    assert.ok(!options.args.join(' ').includes(options.password));
    assert.equal(options.startupDeadlineMs, 150000);
    assert.equal(options.shutdownDeadlineMs, 15000);
  } finally { delete process.env.EP_DATA_DIR; delete process.env.EP_CONFIG; }
});

test('typed and advanced options map to single argv entries', () => {
  const options = prepareOptions({ database: 'test db', username: 'person', password: 's ecret', postgresVersion: '18.6.0', port: 6543,
    cacheDir: '/cache', binaries: '/binaries', storage: { type: 'persistent', dataDir: '/data', workDir: '/work' },
    runAs: { uid: 123, gid: 456 }, startTimeoutMs: 50, stopTimeoutMs: 20, startupDeadlineMs: 60, shutdownDeadlineMs: 2021,
    parameters: { max_connections: '10', 'app.mode': 'test' }, env: { SOME_VARIABLE: 'value' },
    cliOptions: { offline: true, mirror: 'https://example.invalid/pg', 'future-flag': ['a', 'b'], 'future-number': 1 } });
  assert.ok(options.args.includes('--user=123:456'));
  assert.ok(options.args.includes('--database=test db'));
  assert.ok(options.args.includes('--set=max_connections=10'));
  assert.ok(options.args.includes('--offline=true'));
  assert.ok(options.args.includes('--future-flag=b'));
  assert.ok(options.args.includes('--future-number=1'));
  assert.equal(options.env.SOME_VARIABLE, 'value');
  assert.equal(options.env.EP_PASSWORD, 's ecret');
});

for (const options of [
  { port: -1 }, { port: 65536 }, { port: 1.5 }, { startTimeoutMs: 0 }, { stopTimeoutMs: 60001 },
  { shutdownDeadlineMs: 12000 }, { startupDeadlineMs: Infinity }, { password: '' }, { password: 'x\0y' },
  { database: 'x\0y' }, { storage: { type: 'persistent', dataDir: '/data' } },
  { runAs: { uid: 0, gid: 1 } }, { runAs: { uid: -1, gid: 1 } }, { runAs: { uid: 1, gid: 4294967295 } },
  { parameters: { 'bad=name': 'x' } }, { cliOptions: { json: false } }, { cliOptions: { 'parent-stdin': false } },
  { cliOptions: { config: 'x' } }, { cliOptions: { 'data-dir': 'x' } }, { cliOptions: { 'stop-timeout': '100h' } },
  { cliOptions: { '-json': false } }, { env: { ep_password: 'oops' } }, { env: { 'x=y': 'z' } },
  { env: { 'x\0': 'y' } }, { env: { x: 'y\0' } },
]) test(`reject invalid options ${JSON.stringify(options)}`, () => assert.throws(() => prepareOptions(options), { code: 'CONFIG' }));

test('duration validation and credential redaction', () => {
  for (const value of [NaN, -1, 0.5, 2147483648]) assert.throws(() => positiveTimeout(value, 'test'), PostgresError);
  assert.equal(positiveTimeout(1, 'test'), 1);
  assert.equal(redact('a b a%20b postgresql://u:p@host/db', ['a b', '']), '[redacted] [redacted] [redacted connection URL]');
});
