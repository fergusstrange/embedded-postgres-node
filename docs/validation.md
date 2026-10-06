# Validation record — 2026-10-05

Local implementation and packaging validation is complete on macOS ARM64. The Go sibling checkout stayed clean at `356e19e765e005f058501d25f9ff2b893298f53e`. No changes were made to that checkout, no remote was created for this project, and no package was published.

## Verified locally

| Check | Node 22.23.3 | Node 24.12.0 |
| --- | --- | --- |
| Protocol, lifecycle, options and download unit/failure tests | 89 passed | 89 passed |
| Real PostgreSQL lifecycle integration tests | 8 passed | 8 passed |
| node:test suite example | Passed | Passed |
| Vitest 5.0.3 suite example | Passed | Passed |
| Jest 30.5.2 CommonJS suite example | Passed | Passed |
| Explicit/scoped ownership and migration examples | Passed | Passed |
| Installed tarball ESM/CommonJS lifecycle and declaration consumers | Passed | Passed |
| Line / statement coverage | 98.40% | 98.40% |
| Function coverage | 100% | 100% |
| Branch coverage | 96.40% | 96.39% |

Coverage uses c8 and source maps, includes every production implementation file, and excludes only the logic-free export barrel. Every implementation file exceeds 90% for lines, statements, functions and branches. The gate is enforced **per file**, not just on the aggregate. Uncovered paths include the last-resort inherited-pipe reaping fallback and an OS-dependent concurrent cache rename failure.

Real integration used PostgreSQL 18.6.0 and the native Go CLI built from the pinned source with Go 1.26.3. Tests verify SQL, separate ports and isolated clusters, persistent restart with preserved data, cleanup after startup/configuration failure, occupied-port handling, cancellation, normal Node parent exit and forced Node parent termination. Cleanup assertions check both port closure and removal of disposable workspaces. The persistent lease file is intentionally retained by the CLI.

Binary download fixtures verify exact platform mapping, checksum rejection, cache revalidation, offline behavior, concurrent installation, bounded downloads, cancellation/deadlines, filesystem failures, signed-CDN redirects and rejection of unsafe redirect destinations. They do not pretend a v2 release is already published.

`actionlint v1.7.12` passed for both GitHub Actions workflows. The package-content check installs the generated tarball into an isolated consumer project, starts/stops the protocol fixture through both exports, checks TypeScript `.mts` and `.cts` consumers, confirms zero runtime dependencies and restricts included paths and size.

## Decisions and remaining release prerequisites

- Use the CLI protocol boundary; no Node native addon or consumer Go toolchain.
- Support currently maintained LTS lines 22 and 24. Revisit Node 26 when it enters LTS.
- Keep persistent storage explicit, preserve CLI shutdown grace, and report unconfirmed forced cleanup as a failure.
- Require a local executable now or caller-reviewed exact release/hash pins; do not guess an unpublished upstream asset.
- Keep migrations, extension activation and pool cleanup in user-owned JavaScript hooks.
- Proposed npm name `embedded-postgres-node` returned public-registry 404 on 2026-10-05. This is not a name reservation or publication authorization.
- The twelve-job native CI matrix is prepared, but **has not run remotely**. Linux, Windows and the other architecture results must be obtained after an authorized repository is created. Upstream Go results are not wrapper results.
- Add actual public repository metadata, establish npm ownership/trusted publishing, configure required environment reviewers and authorize publication before enabling the release workflow. Publication is off by default; pushes never publish.

See [release preparation](releasing.md). Local ignored logs and tarballs are under `.local/`; coverage output is under `coverage/`. Those are generated artifacts and are not committed.

## Merged upstream follow-up — 2026-10-06

PR #171 merged as `0483a84e6bc989f4cd6893ab852d56fb9756dbcf`. The Node integration pin now uses that merge commit. The local Go checkout at `a879e93bbae7ebde9461c0ee950046ea15099e7a` has the identical Git source tree (`1780db9a0c2c9cd6414ba30f7204a1c75298c1f5`), verified against the GitHub API. A CLI rebuilt from those matching local sources passed all eight real PostgreSQL integration tests on Node 24.12.0/macOS ARM64. The Go checkout was not changed. Documentation now reflects the merged requirement that root RunAs callers provide both a nonzero UID and a nonzero GID.

At this check, the merged Go workflow's native tests, supported-version tests, Alpine, static/security checks and coverage all passed. Its [release job](https://github.com/fergusstrange/embedded-postgres/actions/runs/37439342355/job/112191654690) failed while looking up `releases/tags/v2.0.0-alpha.1` (HTTP 404). The corresponding draft release contained no assets. The wrapper therefore still has no safe published default CLI pin; the upstream upload/publication must complete first.

The proposed Node repository is not yet present under `fergusstrange/embedded-postgres-node`, the npm name still returns 404, and the local npm CLI reports `ENEEDAUTH`. Remaining work is to pin published CLI assets/checksums and test the ordinary consumer download path, create the authorized public Node repository and run its full twelve-job CI matrix, configure first-release npm authentication and trusted publishing, then publish the reviewed `0.1.0-alpha.1` tarball with the `next` dist-tag and verify installation from npm.

## npm setup follow-up — 2026-10-06

The owner logged into npm as `fergusstrange` and authorized package setup. The installed npm 11.13.0 lacked staging, so npm 11.15.0 was invoked temporarily without changing the global installation. The packed library was rebuilt and passed its package-content, ESM/CommonJS lifecycle and TypeScript consumer checks before a setup-only snapshot was staged.

The registry confirms `embedded-postgres-node` is public and maintained by `fergusstrange`, with only npm's generated `0.0.0-stage` placeholder publicly available. `0.0.0-setup.1` is staged under ID `6e550c38-6fbe-439d-bd5b-501539e2f24b`; the product version `0.1.0-alpha.1` remains unused. No library code was approved for public release. Account 2FA was disabled at setup and still needs owner configuration before release approvals. The public GitHub repository and trusted publishing setup remain outstanding.
