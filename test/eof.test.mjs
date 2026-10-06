import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { startPostgres } from '../dist/esm/index.js';
import { fakeOptions } from './helpers.mjs';

// This file has its own test process so the spawn mock cannot affect other tests.
test('protocol EOF while the child lives releases stdin and reports unclean exit', { timeout: 10_000 }, async t => {
  const spawn = childProcess.spawn;
  let child;
  let aliveAtEof = false;
  t.mock.method(childProcess, 'spawn', (...args) => {
    child = spawn(...args);
    const actualStdout = child.stdout;
    const protocol = new PassThrough();
    // Inject EOF into the reader: Node cannot close standard descriptors on
    // Windows. Keep the real child alive, waiting for the library to end stdin.
    actualStdout.once('data', chunk => protocol.end(chunk));
    actualStdout.resume();
    protocol.once('end', () => { aliveAtEof = child.exitCode === null; });
    child.stdout = protocol;
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const pg = await startPostgres(fakeOptions('no-stopped'));
  t.after(() => pg.stop().catch(() => {}));
  const result = await pg.closed;
  assert.equal(aliveAtEof, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stopped, false);
  assert.equal(result.error.code, 'EXIT');
  await assert.rejects(pg.stop(), { code: 'EXIT' });
});
