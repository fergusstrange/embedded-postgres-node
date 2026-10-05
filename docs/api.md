# API

Import from `embedded-postgres-node` with ESM `import` or CommonJS `require`. Both export the same API and corresponding `.d.ts` files.

## Lifecycle

`startPostgres(options?: PostgresOptions): Promise<PostgresInstance>` resolves only after the CLI reports authenticated readiness. Rejection waits for cleanup or the shutdown deadline. A missing CLI configuration is an actionable error; there is no implicit PATH lookup or unpublished release fallback.

`withPostgres<T>(options, callback): Promise<T>` starts, awaits the callback, and stops in a `finally` block. Both callback and cleanup errors are retained in an `AggregateError`. The callback should await migration/setup work and close its drivers/pools before returning. User hooks are ordinary JavaScript functions, not executable CLI configuration.

An instance exposes:

| Member | Contract |
| --- | --- |
| `connectionUrl: string` | Credential returned by CLI readiness; hidden from ordinary inspection and JSON serialization |
| `port: number` | Actual selected port |
| `stop(): Promise<void>` | Idempotent; all calls share one promise; rejects on startup/runtime/shutdown failure |
| `[Symbol.asyncDispose]()` | Same lifecycle as `stop()` |
| `closed: Promise<ExitResult>` | Always resolves: `{ exitCode, signal, stopped, error? }`; `error` is a `PostgresError` |

`closed.stopped` records the protocol event, not an inferred process state. A successful `stop()` requires that event plus exit code zero. Forced teardown returns an error, even if a late stopped event arrives. After a process/pipe shutdown stall, `exitCode` and `signal` may be null; cleanup cannot be confirmed.

## Options

| Option | Default / behavior |
| --- | --- |
| `cli` | `{ path: string }` or pinned release source; otherwise `EMBEDDED_POSTGRES_CLI` |
| `postgresVersion` | CLI's pinned default PostgreSQL distribution |
| `database`, `username` | CLI defaults (`postgres`) |
| `password` | Random 192-bit password, sent through `EP_PASSWORD`, never argv |
| `port` | `0`, dynamic selection; otherwise integer 1–65535 |
| `cacheDir` | CLI PostgreSQL binary cache; separate from the Node CLI executable cache |
| `binaries` | Optional complete custom distribution path containing `bin/` |
| `storage` | Omitted or `{ type: 'disposable', workDir? }`; persistent form is `{ type: 'persistent', dataDir, workDir? }` |
| `runAs` | Optional Unix `{ uid, gid }`; existing nonzero UID, integer IDs below 4294967295 |
| `parameters` | `Record<string, string>` mapped to repeated `--set=name=value` |
| `startTimeoutMs` | `120000`, CLI startup timeout |
| `stopTimeoutMs` | `10000`, CLI shutdown grace; maximum `60000` |
| `startupDeadlineMs` | `startTimeoutMs + 30000`, from before executable resolution through readiness |
| `shutdownDeadlineMs` | `stopTimeoutMs + 5000`; must be strictly greater than `stopTimeoutMs + 2000` |
| `signal` | Optional lifetime `AbortSignal`, including after readiness |
| `env` | Additional environment strings; `EP_*` keys are reserved |
| `cliOptions` | Advanced flag names without `--`, with string/number/boolean or arrays of strings |

All millisecond durations are positive integer Node timer values (up to 2147483647). An outer startup timeout can be shorter than CLI startup: it triggers independent bounded cleanup and is therefore not a total wall-clock deadline for the returned promise. Startup rejection can take the startup deadline plus shutdown deadline plus two seconds for forced pipe closure. As with any JavaScript timer, a blocked event loop delays deadlines.

Persistent mode requires nonempty explicit credentials and a nonempty data path. Runtime validation remains necessary even with TypeScript because JavaScript callers and filesystem states are dynamic.

Advanced flags cannot override `json`, `parent-stdin`, `config`, `state-file`, `password`, `port`, `database`, `username`, `start-timeout`, `stop-timeout`, `data-dir`, `work-dir`, `cache-dir`, `binaries`, `postgres-version`, `user`, `set`, or `help`. Arguments are passed directly without a shell, using `--name=value` so values starting with dashes remain values. Put PostgreSQL settings in `parameters`; put passwords in `password`.

## Executable resolution

`resolveCli(source?: CliSource, signal?: AbortSignal): Promise<string>` lets CI prefetch an explicit, verified CLI release before starting tests. `cliPlatform()` returns one of `linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`, `windows-amd64`, `windows-arm64`. See [binary acquisition](binaries.md).

## Errors

`PostgresError extends Error` has `code` and `stderr` fields. Codes:

| Code | Meaning |
| --- | --- |
| `CONFIG` | Invalid options or missing explicit CLI selection |
| `BINARY` | Local executable or verified download/cache unavailable |
| `SPAWN` | The OS could not start the CLI |
| `PROTOCOL` | Malformed/oversized JSON, wrong protocol, invalid event or order |
| `STARTUP` | CLI reported startup failure |
| `TIMEOUT` | Executable download or outer startup deadline |
| `ABORTED` | Caller cancelled the database lifetime |
| `EXIT` | CLI runtime failure, unexpected exit/stop or missing clean shutdown |
| `SHUTDOWN` | Outer shutdown deadline expired; owner was forcibly terminated |

No automatic diagnostic logging or global handlers are installed. Error causes from the OS/network are intentionally not retained because they can contain credentials or private URLs. `stderr` is at most 64 KiB of characters before redaction and can grow slightly when masking short secrets. Protocol lines are limited to 64 KiB of decoded characters; an oversized event stops parsing and begins teardown.
