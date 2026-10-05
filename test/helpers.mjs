import { fileURLToPath } from 'node:url';
export const fixture = fileURLToPath(new URL('./fixtures/cli.mjs', import.meta.url));
export const fakeOptions = (mode = 'normal', extra = {}) => ({
  cli: { path: process.execPath },
  stopTimeoutMs: 1,
  shutdownDeadlineMs: 2100,
  ...extra,
  env: { NODE_OPTIONS: `--import ${JSON.stringify(fixture)}`, FAKE_MODE: mode, ...extra.env },
});
