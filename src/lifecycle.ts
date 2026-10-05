import { spawn } from 'node:child_process';
import { inspect } from 'node:util';
import { resolveCli } from './binary.js';
import { PostgresError, redact } from './errors.js';
import { prepareOptions } from './options.js';
import type { PostgresOptions } from './options.js';
import { ProtocolParser } from './protocol.js';

export interface ExitResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stopped: boolean;
  readonly error?: PostgresError;
}

export interface PostgresInstance extends AsyncDisposable {
  /** A credential: do not log or snapshot it. */
  readonly connectionUrl: string;
  readonly port: number;
  /** Resolves on termination; never rejects, so ignoring it cannot cause an unhandled rejection. */
  readonly closed: Promise<ExitResult>;
  /** Closes stdin and waits for stopped and process exit. Repeated calls share one result. */
  stop(): Promise<void>;
}

/** Start a database whose lifetime is owned by the caller (or its AbortSignal). */
export async function startPostgres(options: PostgresOptions = {}): Promise<PostgresInstance> {
  const prepared = prepareOptions(options);
  const deadline = new AbortController();
  const lifetime = AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])]);
  const startupTimer = setTimeout(() => deadline.abort(), prepared.startupDeadlineMs);
  let executable: string;
  try {
    executable = await resolveCli(options.cli, lifetime);
    if (lifetime.aborted) throw new PostgresError('ABORTED', 'PostgreSQL startup aborted');
  } catch (error) {
    clearTimeout(startupTimer);
    if (deadline.signal.aborted) throw new PostgresError('TIMEOUT', 'PostgreSQL startup deadline exceeded during CLI resolution');
    throw error;
  }

  return new Promise<PostgresInstance>((resolve, reject) => {
    const child = spawn(executable, prepared.args, { stdio: ['pipe', 'pipe', 'pipe'], env: prepared.env, windowsHide: true, shell: false });
    let ready = false;
    let stopped = false;
    let stopping = false;
    let finished = false;
    let stderr = '';
    let discardStderrLine = false;
    let failure: PostgresError | undefined;
    let brokenProtocol = false;
    let shutdownTimer: NodeJS.Timeout | undefined;
    let reapTimer: NodeJS.Timeout | undefined;
    const secrets = [prepared.password];
    let resolveClosed!: (result: ExitResult) => void;
    const closed = new Promise<ExitResult>(resolve => { resolveClosed = resolve; });
    let stopPromise: Promise<void> | undefined;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(startupTimer);
      clearTimeout(shutdownTimer);
      clearTimeout(reapTimer);
      lifetime.removeEventListener('abort', abort);
      if (!failure && (!ready || !stopped || exitCode !== 0)) {
        failure = new PostgresError('EXIT', `CLI exited ${ready ? 'after' : 'before'} readiness without clean shutdown (code ${exitCode}, signal ${signal})`);
      }
      const error = failure ? new PostgresError(failure.code, redact(failure.message, secrets), redact(stderr, secrets)) : undefined;
      const result: ExitResult = Object.freeze({ exitCode, signal, stopped, ...(error ? { error } : {}) });
      resolveClosed(result);
      if (!ready) reject(error ?? new PostgresError('EXIT', 'CLI exited before readiness'));
    };
    const requestStop = () => {
      if (stopping || finished) return;
      stopping = true;
      clearTimeout(startupTimer);
      child.stdin.end();
      shutdownTimer = setTimeout(() => {
        failure = new PostgresError('SHUTDOWN', `${failure ? failure.message + '; ' : ''}CLI shutdown deadline exceeded; forced owner termination, PostgreSQL cleanup cannot be confirmed`);
        child.kill('SIGKILL');
        // A descendant holding stdio open must not make teardown wait forever.
        reapTimer = setTimeout(() => {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish(child.exitCode, child.signalCode);
        }, 2_000);
      }, prepared.shutdownDeadlineMs);
    };
    const fail = (error: PostgresError) => { failure ??= error; requestStop(); };
    const abort = () => fail(new PostgresError(deadline.signal.aborted ? 'TIMEOUT' : 'ABORTED', deadline.signal.aborted ? 'PostgreSQL startup deadline exceeded' : 'PostgreSQL lifetime aborted'));
    const stop = () => {
      requestStop();
      stopPromise ??= closed.then(result => { if (result.error) throw result.error; });
      return stopPromise;
    };
    const parser = new ProtocolParser(event => {
      if (event.event === 'error') {
        fail(new PostgresError(ready ? 'EXIT' : 'STARTUP', event.error));
      } else if (event.event === 'stopped') {
        if (stopped || !ready) { fail(new PostgresError('PROTOCOL', 'Unexpected CLI stopped event')); return; }
        stopped = true;
        if (!stopping) fail(new PostgresError('EXIT', 'CLI stopped unexpectedly'));
      } else {
        if (ready || stopped) { fail(new PostgresError('PROTOCOL', 'Duplicate or out-of-order CLI ready event')); return; }
        secrets.push(event.connection_url, new URL(event.connection_url).password);
        if (stopping) return;
        ready = true;
        clearTimeout(startupTimer);
        const instance: PostgresInstance = {
          get connectionUrl() { return event.connection_url; },
          port: event.port, closed, stop,
          [Symbol.asyncDispose]: stop,
        };
        // Common inspection/serialization should not accidentally print credentials.
        Object.defineProperties(instance, {
          connectionUrl: { enumerable: false },
          toJSON: { value: () => ({ port: event.port }) },
          [inspect.custom]: { value: () => `PostgresInstance { port: ${event.port} }` },
        });
        resolve(Object.freeze(instance));
      }
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (brokenProtocol) return;
      try { parser.push(chunk); } catch (error) { brokenProtocol = true; fail(error as PostgresError); }
    });
    child.stdout.on('end', () => {
      if (brokenProtocol) return;
      try { parser.finish(); } catch (error) { brokenProtocol = true; fail(error as PostgresError); }
      // Protocol EOF while the owner lives must also release our lifetime pipe.
      if (!stopped) requestStop();
    });
    child.stderr.on('data', (chunk: string) => {
      if (discardStderrLine) {
        const newline = chunk.indexOf('\n');
        if (newline === -1) return;
        chunk = chunk.slice(newline + 1);
        discardStderrLine = false;
      }
      stderr += chunk;
      if (stderr.length > 64 * 1024) {
        stderr = stderr.slice(-64 * 1024);
        // Discard a truncated line entirely, including its future chunks.
        const newline = stderr.indexOf('\n');
        discardStderrLine = newline === -1;
        stderr = discardStderrLine ? '' : stderr.slice(newline + 1);
      }
    });
    child.stdout.on('error', () => fail(new PostgresError('PROTOCOL', 'Unable to read CLI protocol pipe')));
    child.stderr.on('error', () => fail(new PostgresError('EXIT', 'Unable to read CLI diagnostic pipe')));
    child.stdin.on('error', () => fail(new PostgresError('EXIT', 'CLI stdin pipe closed unexpectedly')));
    child.on('error', () => fail(new PostgresError('SPAWN', 'Unable to spawn CLI executable')));
    child.on('close', finish);
    lifetime.addEventListener('abort', abort, { once: true });
    if (lifetime.aborted) abort();
  });
}

/** User-owned migrations/pools belong inside fn; close pools before fn returns. */
export async function withPostgres<T>(options: PostgresOptions, fn: (postgres: PostgresInstance) => Promise<T>): Promise<T> {
  const postgres = await startPostgres(options);
  let failed = false;
  let callbackError: unknown;
  try { return await fn(postgres); } catch (error) { failed = true; callbackError = error; throw error; }
  finally {
    try { await postgres.stop(); } catch (cleanupError) {
      if (failed) throw new AggregateError([callbackError, cleanupError], 'PostgreSQL callback and cleanup both failed');
      throw cleanupError;
    }
  }
}
