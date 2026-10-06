import { writeFileSync } from 'node:fs';
const mode = process.env.FAKE_MODE ?? 'normal';
const password = process.env.EP_PASSWORD;
const url = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:54321/postgres`;
const event = value => process.stdout.write(JSON.stringify({ protocol: 1, ...value }) + '\n');
const ready = { event: 'ready', connection_url: url, port: 54321, extra: 'tolerated' };
if (process.env.ARGS_FILE) writeFileSync(process.env.ARGS_FILE, JSON.stringify({ args: process.argv, ep: Object.keys(process.env).filter(x => x.startsWith('EP_')) }));
process.stdin.resume();
process.stdin.on('end', () => {
  if (mode === 'hang' || mode === 'stopped-hang') return;
  if (mode === 'shutdown-error') { event({ event: 'error', error: 'shutdown failed' }); process.exitCode = 1; return; }
  if (mode === 'no-stopped') { process.exit(0); }
  if (mode === 'slow-stop') {
    setTimeout(() => { event({ event: 'stopped' }); process.exit(0); }, 180);
    return;
  }
  if (mode === 'final-line') process.stdout.write('{"protocol":1,"event":"stopped"}');
  else event({ event: 'stopped' });
  process.exitCode = mode === 'nonzero-stop' ? 5 : 0;
  setImmediate(() => process.exit());
});
if (mode === 'invalid-json') process.stdout.write('not json secret\n');
else if (mode === 'protocol') process.stdout.write('{"protocol":2,"event":"ready"}\n');
else if (mode === 'oversized') process.stdout.write('x'.repeat(70_000));
else if (mode === 'early-exit') process.exit(7);
else if (mode === 'error') {
  process.stderr.write(`password=${password}\nURL ${url}\n`);
  event({ event: 'error', error: `startup failed ${password} ${url}` });
  process.exitCode = 1;
} else if (mode === 'stopped-first') event({ event: 'stopped' });
else if (mode === 'split') {
  const line = JSON.stringify({ protocol: 1, ...ready, extra: '☃' }) + '\r\n';
  const bytes = Buffer.from(line);
  for (const byte of bytes) { process.stdout.write(Buffer.from([byte])); await new Promise(r => setTimeout(r, 1)); }
} else if (mode !== 'never-ready') {
  event(ready);
  if (mode === 'duplicate') event(ready);
  if (mode === 'duplicate-stop') { event({ event: 'stopped' }); event({ event: 'stopped' }); }
  if (mode === 'ready-exit') setTimeout(() => process.exit(9), 40);
  if (mode === 'runtime-error') setTimeout(() => { event({ event: 'error', error: `runtime failure ${url}` }); }, 40);
  if (mode === 'stopped-hang') event({ event: 'stopped' });
  if (mode === 'flood') {
    process.stderr.write('noise\n'.repeat(20_000) + `password=${password}\n${url}\n`);
    setTimeout(() => event({ event: 'error', error: 'diagnostic fixture failure' }), 50);
  }
  if (mode === 'long-stderr') {
    process.stderr.write('x'.repeat(100_000));
    setTimeout(() => process.stderr.write('x'.repeat(100)), 20);
    setTimeout(() => process.stderr.write(`\nknown=${password}\n`), 40);
    setTimeout(() => event({ event: 'error', error: 'long diagnostic fixture failure' }), 60);
  }
}
if (mode === 'hang' || mode === 'stopped-hang') setInterval(() => {}, 1000);
// Keep Node from attempting to load "run" as a script after the preload.
await new Promise(() => {});
