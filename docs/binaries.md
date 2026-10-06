# CLI and PostgreSQL binaries

These are separate acquisitions:

1. The Node package resolves the embedded-postgres **CLI executable**.
2. The CLI resolves a native **PostgreSQL distribution** using its own pinned manifest, shared cache and supervisor.

`startPostgres()` downloads the reviewed [CLI v2.0.0-alpha.1 release](https://github.com/fergusstrange/embedded-postgres/releases/tag/v2.0.0-alpha.1) when needed. Its six SHA-256 pins are embedded in the package and exported as the frozen `DEFAULT_CLI_RELEASE` object. Every asset was downloaded and checked against the published `checksums.txt` before these pins were added. The release tag points to upstream commit `1aa5666cb1b70f044eb74c717e3e0a6ef19cc415`.

The selection order is an explicit `cli` option, then `EMBEDDED_POSTGRES_CLI`, then the package's release pin. An explicit download-options object, including `{}`, selects release acquisition even if the environment names a local CLI. It may omit `release` to retain the package default. Downloads happen during resolution/startup, never during npm installation or import. Consumers need no Go toolchain.

## Prefetch and offline use

```ts
import { resolveCli, startPostgres } from 'embedded-postgres-node';

const cli = { cacheDir: '/path/to/cli-cache' };
await resolveCli(cli); // Optional prefetch for a subsequent offline test run.
const database = await startPostgres({ cli: { ...cli, offline: true } });
try { /* tests */ } finally { await database.stop(); }
```

This example prefetches only the CLI; PostgreSQL must also be cached or supplied through `binaries` for a completely offline run (see below).

## Custom releases and mirrors

To select another reviewed v2 release, pass `cli: { release }`. `CliRelease` contains an exact `version` and a `checksums` map from platform to 64-character SHA-256 digest. Copy those hashes from that release's reviewed `checksums.txt` and include every platform your team uses. Runtime resolution never fetches checksums or selects a newer version automatically. Updating this package's default requires a source change and a new npm version.

`baseUrl`, when omitted, is `https://github.com/fergusstrange/embedded-postgres/releases/download/`. A mirror must serve `BASE/VERSION/ASSET` with bytes matching the trusted pin. To mirror the default release, use `cli: { release: { ...DEFAULT_CLI_RELEASE, baseUrl: 'https://your-mirror.example/cli/' } }` after importing `DEFAULT_CLI_RELEASE`.

For development builds, pass `cli: { path: '/absolute/path/to/embedded-postgres' }` or set `EMBEDDED_POSTGRES_CLI`. Local executables are trusted directly. The optional integration source build uses `.github/upstream.json`, pinned to the published release's commit. Only this development route needs Go.

| Node target | Pin key | Upstream asset |
| --- | --- | --- |
| linux x64 | linux-amd64 | embedded-postgres_linux_amd64 |
| linux arm64 | linux-arm64 | embedded-postgres_linux_arm64 |
| darwin x64 | darwin-amd64 | embedded-postgres_darwin_amd64 |
| darwin arm64 | darwin-arm64 | embedded-postgres_darwin_arm64 |
| win32 x64 | windows-amd64 | embedded-postgres_windows_amd64.exe |
| win32 arm64 | windows-arm64 | embedded-postgres_windows_arm64.exe |

Windows ARM64 maps to the native Go CLI, which selects x64 PostgreSQL under OS emulation.

Downloads have a 120-second default deadline (`downloadTimeoutMs` overrides), a 128 MiB size ceiling, at most five redirects, streamed SHA-256 validation and atomic cache installation. HTTPS is required; HTTP is allowed for loopback test mirrors only. Signed CDN redirect query strings are supported. Base URLs cannot contain credentials, query parameters or fragments. A mismatch is never executed or cached as an installation.

The default CLI cache is `~/.cache/embedded-postgres-node/VERSION/DIGEST/ASSET`. Files use mode 0700 where Unix permissions apply. Concurrent installs are safe because they contain identical verified bytes; partial downloads have unique temporary names and are removed on ordinary failure/cancellation. Each cache hit is hashed again. Offline mode refuses missing/corrupted entries. Online mode can replace corrupted entries with verified bytes. The caller owns cache pruning; do not prune executables used by running tests. An abruptly killed process may leave a `.tmp` file, which is never treated as a verified executable.

Use a private, trusted cache directory. On Windows, privacy is governed by the parent directory ACL. Hash validation protects downloaded/cached content against accidental or remote corruption; it does not defend against a hostile local process replacing files between validation and execution. A caller-supplied local executable is trusted and is not checksummed.

`cli.offline` concerns only the CLI executable. To prohibit PostgreSQL downloads too, use `cliOptions: { offline: true }` with a populated PostgreSQL cache, or supply `binaries`. Use the CLI's `prefetch` command to prepare its PostgreSQL cache ahead of time.
