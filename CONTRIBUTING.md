# Contributing

Use Node 22 or 24 and `npm ci`. Runtime code imports only `node:*` modules and relative package modules. Do not add a runtime driver or test framework dependency to the core.

`npm run check` builds ESM/CommonJS, runs protocol/failure/download tests, enforces at least 90% statement/line/function/branch coverage across production implementation files, packs a tarball, installs it into an isolated temporary project, and checks both module systems and TypeScript declarations. Re-export-only `index.ts` has no logic and is excluded from instrumentation. No production branches are hidden with coverage-ignore annotations.

`npm run test:integration` is a required second gate. It refuses to silently skip when `EMBEDDED_POSTGRES_CLI` is missing. Build the sibling CLI with `node scripts/prepare-integration.mjs ../embedded-postgres`, then export the executable path printed by that command. Optional `EP_TEST_BINARIES` points to an existing PostgreSQL distribution to avoid downloads; `EP_TEST_VERSION` selects the distribution version. They are test harness variables, not ambient CLI configuration.

`npm run test:examples` executes node:test, Vitest, Jest, try/finally, scoped helper and migration examples. Keep examples executable so API/documentation drift fails CI.

The reviewed development CLI pin lives in `.github/upstream.json`. CI checks out that exact upstream commit, builds it with Go, fetches a PostgreSQL distribution using its verified manifest, then runs the Node tests. `prepare-integration.mjs` checks the commit in CI. Local builds may intentionally use uncommitted upstream work but print the revision; never claim that as a clean release validation.

GitHub Actions configures twelve native jobs: six OS/architecture combinations times Node 22/24. Current hosted labels are documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). The workflow is prepared locally; no remote results exist until an authorized public repository is created and workflows run. Do not confuse upstream Go coverage or CI with evidence for this wrapper.

Do not add process signal handlers at module import. Preserve independent cleanup deadlines after cancellation. Treat protocol URLs, password arguments and abort reasons as credentials. Fault tests should use small local executable/server fixtures, not live arbitrary release URLs. Include meaningful behavior assertions, especially ports and workspaces actually disappearing after a real PostgreSQL lifecycle.

Commit source, tests, documentation and `package-lock.json`; do not commit downloaded executables, database data, coverage output or tarballs. See [releasing](docs/releasing.md) for publication prerequisites and approval gates.
