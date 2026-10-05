# embedded-postgres-node

Real PostgreSQL for Node.js tests, supervised by the [embedded-postgres v2 CLI](https://github.com/fergusstrange/embedded-postgres/pull/171). TypeScript types, ESM and CommonJS, dynamic ports, explicit async cleanup, and **zero runtime npm dependencies**. Use your own PostgreSQL driver, test runner and migration framework.

**Development preview:** this Node package is not published. No v2 CLI release is currently pinned or assumed available. Use a local CLI built from the sibling Go project. `embedded-postgres-node` is the proposed npm name: the public registry returned 404 on 2026-10-05; this does not reserve the name or establish publishing rights.

## Try it locally

```sh
# In this repository; Node 22 or 24 and Go 1.26+ are development prerequisites.
npm ci
npm run build
node scripts/prepare-integration.mjs ../embedded-postgres
export EMBEDDED_POSTGRES_CLI="$PWD/.local/embedded-postgres" # Windows: .exe
node --test examples/node-test.mjs
```

PowerShell: `$env:EMBEDDED_POSTGRES_CLI = "$PWD\.local\embedded-postgres.exe"`.
Consumers of a published CLI will not need Go. PostgreSQL binaries are acquired by the CLI, with its native runtime-library requirements. No package install script downloads or executes binaries.

To try the package in another project, run `npm pack` here, then `npm install --save-dev /path/to/embedded-postgres-node-0.1.0-alpha.1.tgz` there. Pass an explicit `cli: { path }`, or set `EMBEDDED_POSTGRES_CLI`.

## A database for a test

```js
import { withPostgres } from 'embedded-postgres-node';
import pg from 'pg'; // Install your own driver as a development dependency.

await withPostgres({ cli: { path: '/absolute/path/to/embedded-postgres' } }, async database => {
  const pool = new pg.Pool({ connectionString: database.connectionUrl });
  try {
    await pool.query('CREATE TABLE widgets (id integer PRIMARY KEY)');
    // Run migrations and tests here.
  } finally {
    await pool.end();
  }
});
```

`withPostgres` returns your callback's result and awaits cleanup on success or failure. If both fail, it throws an `AggregateError` containing both errors. There are no framework-specific core dependencies or implicit global signal handlers.

For suite-level setup, use `startPostgres()` in your runner's setup hook and `await database.stop()` in teardown. Close pools first. Increase the runner's hook timeout to allow initial binary downloads; share a server only when tests isolate their own schemas or data. Each separately started instance gets its own disposable directory and dynamic port.

Runnable examples:

- [node:test suite](examples/node-test.mjs)
- [Vitest suite](examples/vitest.test.mjs) and [config](examples/vitest.config.mjs)
- [Jest suite (CommonJS)](examples/jest.test.cjs) and [config](examples/jest.config.cjs)
- [Explicit try/finally and scoped helper](examples/scoped.mjs)
- [User-owned migration and extension setup](examples/migrations.mjs)

## Explicit ownership

```js
import { startPostgres } from 'embedded-postgres-node';

const database = await startPostgres({ /* cli omitted when EMBEDDED_POSTGRES_CLI is set */ });
try {
  // database.connectionUrl is a credential. Do not log or snapshot it.
  // database.port is available after an authenticated readiness check.
} finally {
  await database.stop(); // Idempotent, including concurrent calls.
}
```

An optional `signal` controls the entire database lifetime. Cancellation requests cleanup and reports `PostgresError` with `code: 'ABORTED'`. The signal's reason is not copied into diagnostics. `database.closed` always resolves to an exit result, including errors, so a background failure cannot cause an unhandled promise rejection. Observe it for long-lived suites; `stop()` also reports any failure. `[Symbol.asyncDispose]()` delegates to `stop()` for TypeScript `await using` or runtimes supporting that syntax.

## Configuration

```ts
const database = await startPostgres({
  cli: { path: '/absolute/path/to/embedded-postgres' },
  postgresVersion: '18.6.0',
  database: 'application_test',
  port: 0,
  storage: { type: 'disposable', workDir: '/tmp/test-work' },
  cacheDir: '/path/to/shared-postgres-cache',
  parameters: { max_connections: '40' },
  startTimeoutMs: 120_000,
  stopTimeoutMs: 10_000,
});
```

Defaults select a dynamic port and a random password. `workDir` is a parent for private disposable children; it is never recursively erased by the wrapper. For persistence, choose `storage: { type: 'persistent', dataDir: '/path/to/data' }` **and explicit `database`, `username`, and `password`**. Data and the adjacent CLI lease file survive shutdown. Reuse the same credentials on restart; deleting persistent data is your responsibility.

`binaries` supplies an existing PostgreSQL distribution containing `bin/`. `runAs: { uid, gid }` selects an existing non-root Unix account; the wrapper does not invoke sudo or create users. `cliOptions` provides advanced flags, for example `{ offline: true, 'socket-dir': '/tmp/sockets' }`. The CLI rejects unknown flags. Protocol, timeouts, credentials, configuration files and core options cannot be overridden through this escape hatch. Ambient `EP_*` variables are removed from the child environment; use the typed options and explicit escape hatch. Other environment variables are inherited, with additions through `env`.

See the [full API](docs/api.md), [binary acquisition](docs/binaries.md), and [integration and migration guide](docs/integration.md).

## Cleanup and diagnostics

The wrapper spawns `run --json --parent-stdin`, keeps stdin open until teardown, parses protocol 1 incrementally, and waits for **both `stopped` and process exit**. Shutdown uses its own deadline, even after cancellation. The default outer shutdown deadline is `stopTimeoutMs + 5 seconds`; an override must exceed `stopTimeoutMs + 2 seconds`. If it expires, the wrapper terminates only its retained CLI child and reports that PostgreSQL cleanup cannot be confirmed. It waits up to two further seconds for process/pipe closure.

A Node crash or forced Node termination closes the ownership pipe; the CLI and its independent supervisor perform cleanup. Whole-machine failure, simultaneous termination of the supervisor and PostgreSQL, or an unresponsive supervisor cannot be promised graceful cleanup. See [upstream lifecycle limits](https://github.com/fergusstrange/embedded-postgres/blob/codex/embedded-postgres-v2/docs/cli.md). Normal application shutdown should await `stop()`; no import installs process signal handlers. If your application owns signals, install handlers there.

Errors expose a stable `code`, a descriptive `message`, and a bounded `stderr` tail. Known passwords and PostgreSQL URLs are redacted; raw protocol, argv, abort reasons and child error causes are not included. Arbitrary custom programs can emit other secrets, so review diagnostics before sharing them. The instance's normal JSON serialization and inspection omit the connection URL; reading the property still returns the real credential.

## Support and development

Node 22 and 24 are the supported LTS lines as of 2026-10-05 ([official schedule](https://github.com/nodejs/Release#release-schedule)); Node 20 is EOL, and Node 26 is not yet LTS. CI is configured for both LTS versions on Linux, macOS and Windows, each on x64 and ARM64. Windows ARM64 uses a native CLI and x64 PostgreSQL under emulation. Linux PostgreSQL runtime libraries are still required; Alpine/musl needs a compatible distribution. See [upstream non-root and native requirements](https://github.com/fergusstrange/embedded-postgres/blob/codex/embedded-postgres-v2/docs/non-root.md).

```sh
npm run check             # Coverage >=90% and installed-tarball smoke/type checks
npm run test:integration  # Requires EMBEDDED_POSTGRES_CLI; fails if missing
npm run test:examples     # Runs all three runners and both hook/scoped examples
```

Integration tests run SQL and verify port/workspace cleanup after teardown, startup failure, abort and Node parent death, plus persistent restarts. [Contributing](CONTRIBUTING.md) explains the pinned upstream development build and CI. [Release preparation](docs/releasing.md) describes the review gate; nothing is published automatically on push.

MIT licensed. PostgreSQL distributions retain their own licenses.
