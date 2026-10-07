# Release preparation

The public source repository is [fergusstrange/embedded-postgres-node](https://github.com/fergusstrange/embedded-postgres-node), and the npm package is owned by `fergusstrange`. Version `0.1.0` is the first regular release and uses the `latest` dist-tag. It promotes the verified `0.1.0-alpha.2` library without runtime changes. The API remains in initial development before `1.0.0`, and the default Go CLI pin remains the prerelease `v2.0.0-alpha.1`. Releasing requires the owner's explicit authorization; pushes run CI without publishing. The registration history below records the earlier setup-only placeholder and draft. The `v0.1.0-alpha.1` tag remains unchanged after its publish command failed before uploading a package.

## Before a release

1. npm ownership is established: `embedded-postgres-node` is owned by `fergusstrange`. Enable account 2FA before approving staged releases or configuring protected publishing. Verify the account with `npm whoami`; do not commit npm credentials.
2. The owner authorized creation of the public source repository, and package.json now includes its actual `repository`, `homepage` and `bugs` URLs. Keep npm provenance tied to this repository.
3. Review the API, MIT license, README status and native prerequisites. The default CLI now pins the published `v2.0.0-alpha.1` assets with reviewed checksums. Run `npm run check:release` to verify real downloads, SQL and offline reuse through the installed package. For future pin updates, independently verify all six assets against upstream checksums and update `.github/upstream.json` to the corresponding release commit.
4. Run the full native CI matrix. Local macOS results are not substitutes for Linux/Windows results.
5. Configure an `npm` GitHub environment with required reviewers and tag restrictions. Configure npm's trusted publisher for the authorized repository, `release.yml`, and environment `npm`. Keep `NPM_PUBLISH_ENABLED` unset until publication is authorized and these protections are verified. Confirm the installed npm version satisfies the current [trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/).

## Preparing a review artifact

Update the package version and lockfile together, review the diff, and create an immutable tag `vVERSION`. Run `Review and publish package` with that existing tag and `publish: false`; also select the same tag in GitHub's **Use workflow from** selector (or `gh workflow run --ref TAG`). The dispatch ref and commit must match the selected tag so npm provenance binds to the tested source. The workflow resolves the tag once to a commit, checks it matches package.json, and reruns all twelve CI jobs for that commit. It then packs and smoke-tests the tarball and uploads `reviewed-npm-package`.

Locally, `npm run check:package` produces the same `.local/*.tgz` shape and validates contents, runtime dependency absence, ESM/CommonJS startup and declaration consumers. The packaging job also dry-runs publication with the same explicit tarball path, access and dist-tag options as the publish job. No install-time download or Go build is permitted in the npm package. Review the exact tarball before enabling publication.

## Publishing an approved artifact

After explicit owner authorization, rerun the workflow with `publish: true` and `NPM_PUBLISH_ENABLED=true`. The protected `npm` environment is the final human gate. The publish job consumes the exact tarball from the successful packaging job; it does not rebuild from a moving branch. It uses npm OIDC trusted publishing and provenance, without a stored publishing token.

This regular release has `publishConfig.tag: latest`, and both workflow commands explicitly pass `--tag latest` because publishing a tarball must not rely on its embedded publish configuration. For a future prerelease, deliberately change both the package configuration and workflow commands to `next`; changing only the numeric version does not change the dist-tag. Prefix relative tarball paths with `./` so npm cannot interpret them as GitHub shorthand. Confirm package ownership and publishing setup before a release; the workflow does not bypass onboarding.

The workflow validates the presence of real repository metadata and stays disabled unless both the dispatch input and repository variable opt in. These are supplemental controls; GitHub environment protection must be configured by the repository owner. Do not assume naming an environment automatically creates a required-reviewer policy.

After publication, verify npm metadata, integrity and provenance, then install the published version into a clean consumer project with an empty npm cache. Wait for npm processing and registry caches to make the tarball available before declaring verification complete. Publish the corresponding GitHub release only after those checks pass. Do not overwrite existing versions or move release tags.

## Verified alpha release — 2026-10-07

The [v0.1.0-alpha.2 release run](https://github.com/fergusstrange/embedded-postgres-node/actions/runs/37551200454) passed all twelve native jobs, package checks and the publish dry run. The owner approved the protected `npm` environment, and OIDC publication succeeded with signed provenance. An installation using an empty npm cache verified the public tarball's integrity against the reviewed CI artifact, registry signature and provenance, TypeScript declarations, ESM/CommonJS operation, fresh CLI and PostgreSQL downloads, SQL, offline reuse and cleanup. The provenance references commit `adcd7e3c39c67f319e91303e532adb25a627ac44` and that release run.

The command explicitly selected `next`, but the registry subsequently listed the alpha under both `next` and `latest`. Version `0.1.0` deliberately replaces `latest` with the first regular release.

## npm registration record — 2026-10-06

The account owner requested npm setup, and registration used `npm stage publish` with npm 11.15.0 (invoked temporarily; the global npm installation was unchanged). [npm staged publishing](https://docs.npmjs.com/staged-publishing/) creates a public placeholder while keeping the submitted version's code unavailable until approval.

- Public package: `embedded-postgres-node`, owner `fergusstrange`.
- Public placeholder: `0.0.0-stage`; at registration, `latest` pointed to this npm-generated placeholder.
- Setup draft: `0.0.0-setup.1`, tag `setup`.
- Stage ID: `6e550c38-6fbe-439d-bd5b-501539e2f24b`.
- Planned product prerelease remains `0.1.0-alpha.1`, tag `next`; that version was not staged or published.

The setup draft is a snapshot of the locally verified package with only setup version/publishing metadata changed. It was uploaded locally without provenance and should not be approved as the product release. Keep it pending or reject it later after the owner enables 2FA; ordinary publication of a different version remains possible while a draft is pending. The actual product release should come from the reviewed CI tarball with provenance.

Inspect the draft with `npm exec --yes --package=npm@11.15.0 -- npm stage view 6e550c38-6fbe-439d-bd5b-501539e2f24b`. The initial `npm trust list` readback returned registry HTTP 403; no trusted publisher was configured during registration. GitHub Actions trusted publishing was configured and verified during the subsequent alpha release. Do not approve this setup draft merely to make the package settings accessible; ownership already exists.
