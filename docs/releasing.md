# Release preparation

This repository is currently local. No public Git remote or npm publication has been created. Publication requires the owner's explicit authorization; the workflows are preparation only.

## Before the first release

1. Recheck the npm name, establish ownership, and choose the final name. The 2026-10-05 404 for `embedded-postgres-node` is a point-in-time registry observation, not a reservation or guarantee.
2. Create the public source repository only after authorization. Add the actual `repository`, `homepage` and `bugs` metadata to package.json; no nonexistent URL is claimed now. npm provenance must point to the real public repository.
3. Review the API, MIT license, README status and native prerequisites. Confirm whether the preview remains local-CLI-only or add real reviewed CLI release pins after v2 assets exist. Never fabricate an upstream release version or digest.
4. Run the full native CI matrix. Local macOS results are not substitutes for Linux/Windows results.
5. Configure an `npm` GitHub environment with required reviewers and tag restrictions. Configure npm's trusted publisher for the authorized repository, `release.yml`, and environment `npm`. Keep `NPM_PUBLISH_ENABLED` unset until publication is authorized and these protections are verified. Confirm the installed npm version satisfies the current [trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/).

## Preparing a review artifact

Update the package version and lockfile together, review the diff, and create an immutable tag `vVERSION`. Run `Review and publish package` with that existing tag and `publish: false`; also select the same tag in GitHub's **Use workflow from** selector (or `gh workflow run --ref TAG`). The dispatch ref and commit must match the selected tag so npm provenance binds to the tested source. The workflow resolves the tag once to a commit, checks it matches package.json, and reruns all twelve CI jobs for that commit. It then packs and smoke-tests the tarball and uploads `reviewed-npm-package`.

Locally, `npm run check:package` produces the same `.local/*.tgz` shape and validates contents, runtime dependency absence, ESM/CommonJS startup and declaration consumers. No install-time download or Go build is permitted in the npm package. Review the exact tarball before enabling publication.

## Publishing an approved artifact

After explicit owner authorization, rerun the workflow with `publish: true` and `NPM_PUBLISH_ENABLED=true`. The protected `npm` environment is the final human gate. The publish job consumes the exact tarball from the successful packaging job; it does not rebuild from a moving branch. It uses npm OIDC trusted publishing and provenance, without a stored publishing token.

This initial prerelease has `publishConfig.tag: next`. For a stable release, deliberately review changing it to `latest`; changing only the numeric version does not promote the dist-tag. Confirm package ownership and first-publication setup with the current npm UI/CLI before attempting the first publish; the workflow does not bypass that onboarding.

The workflow validates the presence of real repository metadata and stays disabled unless both the dispatch input and repository variable opt in. These are supplemental controls; GitHub environment protection must be configured by the repository owner. Do not assume naming an environment automatically creates a required-reviewer policy.

After publication, verify npm metadata, integrity and provenance, then install the published version into a clean consumer project. Do not overwrite existing versions or move release tags.
