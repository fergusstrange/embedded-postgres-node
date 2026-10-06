# Contributing

Use Node 22 or 24 and `npm ci`. Runtime code imports only `node:*` modules and relative package modules. Do not add a runtime driver or test framework dependency to the core.

`npm run check` builds ESM/CommonJS, runs protocol/failure/download tests, enforces at least 90% statement/line/function/branch coverage in every production implementation file, packs a tarball, installs it into an isolated temporary project, and checks both module systems and TypeScript declarations. Re-export-only `index.ts` has no logic and is excluded from instrumentation. No production branches are hidden with coverage-ignore annotations.

`npm run check:release` also starts a real database from that installed tarball. It uses fresh CLI and PostgreSQL caches for ESM, executes SQL, verifies teardown, and repeats with CommonJS in offline mode. This requires network access and PostgreSQL's native runtime libraries, but no Go toolchain. All twelve CI jobs run this check against the published default CLI.

`npm run test:integration` is a required second gate. It refuses to silently skip when `EMBEDDED_POSTGRES_CLI` is missing. To exercise the published pin after `npm run build`, use `export EMBEDDED_POSTGRES_CLI="$(node --input-type=module -e 'import { resolveCli } from "./dist/esm/index.js"; console.log(await resolveCli({}));')"`. Alternatively, build the sibling CLI with `node scripts/prepare-integration.mjs ../embedded-postgres`, then export the executable path printed by that command. Optional `EP_TEST_BINARIES` points to an existing PostgreSQL distribution to avoid downloads; `EP_TEST_VERSION` selects the distribution version. They are test harness variables, not ambient CLI configuration.

`npm run test:examples` executes node:test, Vitest, Jest, try/finally, scoped helper and migration examples. Keep examples executable so API/documentation drift fails CI.

The reviewed development CLI pin lives in `.github/upstream.json` and matches the default release's commit. In addition to the installed-package release check, CI checks out that exact upstream commit, builds it with Go, fetches a PostgreSQL distribution using its verified manifest, then runs the full lifecycle tests and examples. `prepare-integration.mjs` checks the commit in CI. Local builds may intentionally use uncommitted upstream work but print the revision; never claim that as a clean release validation.

GitHub Actions configures twelve native jobs: six OS/architecture combinations times Node 22/24. Current hosted labels are documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Follow this wrapper's [CI runs](https://github.com/fergusstrange/embedded-postgres-node/actions/workflows/ci.yml) for remote results. Do not confuse upstream Go coverage or CI with evidence for this wrapper.

Do not add process signal handlers at module import. Preserve independent cleanup deadlines after cancellation. Treat protocol URLs, password arguments and abort reasons as credentials. Fault tests should use small local executable/server fixtures, not live arbitrary release URLs. Include meaningful behavior assertions, especially ports and workspaces actually disappearing after a real PostgreSQL lifecycle.

Commit source, tests, documentation and `package-lock.json`; do not commit downloaded executables, database data, coverage output or tarballs. See [releasing](docs/releasing.md) for publication prerequisites and approval gates.
