# Test-runner integration and migration

Choose one database per test for isolation, or one per suite when startup cost matters. With a shared server, allocate a schema/database per parallel test or use an application-appropriate transaction strategy. This library does not reset application state or wrap SQL transactions.

## Suite lifecycle

The checked-in examples run real SQL in `node:test`, Vitest and Jest. Each uses its runner's suite-level setup/teardown, an explicit startup allowance of 180 seconds, and pool-before-server cleanup. They can be copied into your project after installing your chosen driver. `npm run test:examples` runs all examples locally after you set `EMBEDDED_POSTGRES_CLI`.

Runner hook timeouts must exceed wrapper startup plus shutdown allowances. On a cold or slow network, prefetch CLI/PostgreSQL distributions ahead of the suite or increase both the wrapper and runner timeouts. Tests should not depend on downloads fitting into a runner's common 5-second default.

Use `before`/`after` for node:test, `beforeAll`/`afterAll` for Vitest or Jest. When registering teardown separately, ensure it handles setup that failed partway through. The examples use optional handles and nested `try/finally`, so pool cleanup failure still attempts server shutdown.

Runner-wide setup in a separate worker/process must keep its owner process and stdin pipe alive until teardown. Passing only a connection URL out of a short-lived setup process causes intentional cleanup when that owner exits. Prefer per-suite ownership or use the Go CLI's separate authenticated `start`/`stop` workflow directly if you explicitly need a daemon. The Node API owns foreground `run` processes only.

## Migration from manually managed PostgreSQL

1. Replace fixed ports with `startPostgres()` and `database.connectionUrl`.
2. Pass that URL directly to your existing driver instead of logging it or writing a shared credential file.
3. Run your existing migration/seed function after startup. The ready event means PostgreSQL is authenticated and the requested database exists; it does not mean your application schema is migrated.
4. Close pools, streams and migration handles before `await database.stop()`.
5. Remove persistent test data paths unless persistence is an explicit test requirement. Disposable private clusters are the default.

There is no automatic API compatibility claim with unrelated npm packages named `embedded-postgres`. This is a new CLI-based library, not a drop-in major upgrade of another Node package.

## Migrations and extensions

[The migration example](../examples/migrations.mjs) demonstrates a user-owned async hook inside `withPostgres`. Call your preferred framework's migration function there and await its completion. Throwing from the hook still tears down the server. Keep transaction semantics in the migration framework.

For pgvector, PostGIS, AGE or TimescaleDB, supply a compatible custom distribution through `binaries`, including extension libraries and control/SQL files. Configure preload settings with `parameters` before startup, then enable extensions through your driver after readiness. The Node package does not build, download or add core dependencies for extensions. Never patch a shared CLI-owned PostgreSQL cache in place.

## RunAs and containers

A normal non-root caller uses its own identity. A root caller must explicitly supply both a nonzero Unix UID and nonzero GID via `runAs`; an omitted group is never inferred. A non-root caller may retain its own GID 0; an unprivileged caller cannot choose another identity. Caller-owned workspace/socket parents and persistent paths must be accessible to that account. Windows does not support Unix UID/GID selection. Consult the upstream [non-root guide](https://github.com/fergusstrange/embedded-postgres/blob/codex/embedded-postgres-v2/docs/non-root.md) for native runtime libraries and ownership behavior.

## Signals and errors

The package installs no SIGINT/SIGTERM/exit handlers. Normal framework teardown should await `stop()`. Applications that install their own signal handlers should allow this asynchronous cleanup to finish before exiting. `process.on('exit')` cannot await a promise. `SIGKILL` cannot be handled; pipe closure delegates cleanup to the surviving CLI/supervisor, subject to the limits in the README.

An optional `AbortSignal` covers the entire lifetime. If you only want to limit startup, use `startupDeadlineMs`, rather than a signal that your runner may abort before its teardown hooks close pools. `closed` resolves with runtime failure details even when no caller is currently awaiting `stop()`.
