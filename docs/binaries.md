# CLI and PostgreSQL binaries

These are separate acquisitions:

1. The Node package resolves the embedded-postgres **CLI executable**.
2. The CLI resolves a native **PostgreSQL distribution** using its own pinned manifest, shared cache and supervisor.

A local CLI path is the current development route. There is no published v2 CLI pin in this package. The checked-in integration build uses Go commit `0483a84e6bc989f4cd6893ab852d56fb9756dbcf`; no runtime code downloads that branch or assumes it has release assets. The Go toolchain is needed only to build development CLI executables.

## After an upstream v2 release exists

Create a reviewed JSON file from that release's `checksums.txt`. The format is:

```ts
import { readFile } from 'node:fs/promises';
import { resolveCli, startPostgres, type CliRelease } from 'embedded-postgres-node';

// Authored and checked into YOUR project after reviewing a real published release.
const release: CliRelease = JSON.parse(await readFile('./verified-cli-release.json', 'utf8'));
const cli = { release, cacheDir: '/path/to/cli-cache' };
await resolveCli(cli); // Optional prefetch for a subsequent offline test run.
const database = await startPostgres({ cli: { ...cli, offline: true } });
try { /* tests */ } finally { await database.stop(); }
```

`CliRelease` contains an exact `version` such as the tag of that reviewed release and a `checksums` map from platform to 64-character SHA-256 digest. This document intentionally supplies no fake tag/digest combination. Include every platform your team uses. `baseUrl`, when omitted, is `https://github.com/fergusstrange/embedded-postgres/releases/download/`. A mirror must serve `BASE/VERSION/ASSET` with bytes matching the trusted pin.

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
