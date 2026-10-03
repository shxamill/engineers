# Release process

This document defines the repository-level release procedure for the `engineering-os` plugin. It is intentionally separate from the plugin implementation and is the authoritative checklist for publishing a version.

## Release inputs

A release starts from a specific commit on `main`. The plugin version in `plugins/engineering-os/.claude-plugin/plugin.json`, the matching `CHANGELOG.md` entry, migration notes when required, and the release notes must all describe the same version.

## Pre-release gate

Before creating the tag:

1. Confirm the version and changelog entry.
2. Run the repository checks in `CONTRIBUTING.md`.
3. Confirm `org-ci` is green on Ubuntu, Windows, and robustness.
4. Confirm `repository-hygiene` is green.
5. Review Dependabot, secret-scanning, and code-scanning findings relevant to the release.
6. Confirm migration/compatibility notes for breaking changes.
7. Verify the exact release commit is the intended `main` commit.

Do not treat a version string alone as release readiness.

## Tag and GitHub Release

Create an immutable Git tag in the form `v<version>` pointing at the validated `main` commit, then create the GitHub Release from that exact tag.

For this repository, `v3.0.0` is the first planned public release tag.

The release notes should summarize user-visible changes and link to the corresponding changelog and migration guide. Do not rewrite source history as part of a release.

## Post-release verification

After publication:

- verify the tag points to the intended commit;
- verify the GitHub Release is published;
- verify the plugin manifest still reports the released version;
- verify the marketplace resolves the plugin from the repository;
- run a clean install/update smoke test from a fresh clone when practical;
- record any release-specific findings in `docs/engineering/`.

## Rollback

Do not delete a published release tag as a routine rollback method. Prefer a corrective patch release with a new version. If a release is withdrawn for a security or legal reason, document the reason and the replacement/withdrawal path before changing the public release state.
