import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PostgresError, positiveTimeout } from './errors.js';
import type { CliSource } from './binary.js';

export interface PostgresOptions {
  /** Explicit executable/release; otherwise EMBEDDED_POSTGRES_CLI or the package's pinned release. */
  cli?: CliSource;
  postgresVersion?: string;
  database?: string;
  username?: string;
  password?: string;
  /** Zero (the default) lets PostgreSQL select an available port. */
  port?: number;
  cacheDir?: string;
  binaries?: string;
  storage?: { type: 'disposable'; workDir?: string } | { type: 'persistent'; dataDir: string; workDir?: string };
  runAs?: { uid: number; gid: number };
  parameters?: Readonly<Record<string, string>>;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** Outer startup deadline, including executable resolution. Defaults to startTimeoutMs + 30s. */
  startupDeadlineMs?: number;
  /** Must exceed stopTimeoutMs + 2s. Defaults to stopTimeoutMs + 5s. */
  shutdownDeadlineMs?: number;
  /** Lifetime cancellation: abort before or after readiness requests cleanup. */
  signal?: AbortSignal;
  /** Additional child environment. EP_* keys are reserved. */
  env?: Readonly<Record<string, string>>;
  /** CLI flag names without --. Core, credential, config and lifecycle flags are reserved. */
  cliOptions?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface PreparedOptions {
  args: string[];
  env: NodeJS.ProcessEnv;
  password: string;
  startupDeadlineMs: number;
  shutdownDeadlineMs: number;
}

const reserved = new Set(['json', 'parent-stdin', 'config', 'state-file', 'password', 'port', 'database', 'username', 'start-timeout', 'stop-timeout', 'data-dir', 'work-dir', 'cache-dir', 'binaries', 'postgres-version', 'user', 'set', 'help']);

export function prepareOptions(options: PostgresOptions): PreparedOptions {
  const start = positiveTimeout(options.startTimeoutMs ?? 120_000, 'startTimeoutMs');
  const stop = positiveTimeout(options.stopTimeoutMs ?? 10_000, 'stopTimeoutMs');
  if (stop > 60_000) throw new PostgresError('CONFIG', 'stopTimeoutMs must not exceed the CLI maximum of 60000');
  const startupDeadlineMs = positiveTimeout(options.startupDeadlineMs ?? start + 30_000, 'startupDeadlineMs');
  const shutdownDeadlineMs = positiveTimeout(options.shutdownDeadlineMs ?? stop + 5_000, 'shutdownDeadlineMs');
  if (shutdownDeadlineMs <= stop + 2_000) throw new PostgresError('CONFIG', 'shutdownDeadlineMs must exceed stopTimeoutMs + 2000');
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new PostgresError('CONFIG', 'port must be an integer between 0 and 65535');
  if (options.storage?.type === 'persistent' && (!options.storage.dataDir || !options.password || !options.username || !options.database)) {
    throw new PostgresError('CONFIG', 'Persistent storage requires dataDir and explicit database, username and password');
  }
  if (options.password === '') throw new PostgresError('CONFIG', 'password must not be empty');
  const password = options.password ?? randomBytes(24).toString('base64url');
  const args = ['run', '--json', '--parent-stdin', `--port=${port}`, `--start-timeout=${start}ms`, `--stop-timeout=${stop}ms`];
  const add = (name: string, value: string | undefined) => {
    if (value !== undefined) {
      if (value.includes('\0')) throw new PostgresError('CONFIG', 'CLI options cannot contain NUL characters');
      args.push(`--${name}=${value}`);
    }
  };
  add('database', options.database);
  add('username', options.username);
  add('postgres-version', options.postgresVersion);
  add('cache-dir', options.cacheDir === undefined ? undefined : resolve(options.cacheDir));
  add('binaries', options.binaries === undefined ? undefined : resolve(options.binaries));
  add('work-dir', options.storage?.workDir === undefined ? undefined : resolve(options.storage.workDir));
  if (options.storage?.type === 'persistent') add('data-dir', resolve(options.storage.dataDir));
  if (options.runAs) {
    for (const id of [options.runAs.uid, options.runAs.gid]) {
      if (!Number.isInteger(id) || id < 0 || id >= 4_294_967_295) throw new PostgresError('CONFIG', 'runAs IDs must be unsigned integers below 4294967295');
    }
    if (options.runAs.uid === 0) throw new PostgresError('CONFIG', 'runAs.uid must be nonzero');
    add('user', `${options.runAs.uid}:${options.runAs.gid}`);
  }
  for (const [name, value] of Object.entries(options.parameters ?? {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) throw new PostgresError('CONFIG', 'Invalid PostgreSQL parameter name');
    add('set', `${name}=${value}`);
  }
  for (const [name, value] of Object.entries(options.cliOptions ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || reserved.has(name)) throw new PostgresError('CONFIG', 'Invalid or reserved advanced CLI option');
    for (const item of Array.isArray(value) ? value : [value]) add(name, String(item));
  }
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    // Do not allow ambient CLI configuration to turn disposable tests persistent.
    if (!name.toUpperCase().startsWith('EP_')) env[name] = value;
  }
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (name.toUpperCase().startsWith('EP_') || name.includes('=') || name.includes('\0') || value.includes('\0')) {
      throw new PostgresError('CONFIG', 'Invalid or reserved child environment variable');
    }
    env[name] = value;
  }
  if (password.includes('\0')) throw new PostgresError('CONFIG', 'password cannot contain NUL characters');
  env.EP_PASSWORD = password;
  return { args, env, password, startupDeadlineMs, shutdownDeadlineMs };
}
