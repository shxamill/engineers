# GitHub repository governance

This repository uses GitHub as the collaboration boundary around Engineering OS. The repository's engineering rules live in `CONTRIBUTING.md` and the `docs/engineering/` records; this document describes the GitHub-side controls.

## Operating model

```
Issue
  -> feature/fix branch
  -> pull request
  -> automated checks
  -> review
  -> squash merge
  -> main
```

Do not use `main` as a personal working branch. Branches should be short-lived and named by intent, for example:

- `feat/<slug>`
- `fix/<slug>`
- `refactor/<slug>`
- `docs/<slug>`
- `chore/<slug>`
- `hotfix/<slug>`

## Pull requests

Every PR should explain:

1. what changed;
2. why it changed;
3. how it was validated;
4. what could break and how it would be rolled back.

Engineering OS behavior changes also follow the stronger requirements in `CONTRIBUTING.md`: regression/eval coverage, process decision records, and plugin versioning where applicable.

## Ownership

`.github/CODEOWNERS` currently assigns the repository to `@shxamill`, because the repository is presently owned by that GitHub account. When a GitHub Organization and engineering teams are established, CODEOWNERS should move to team ownership and high-risk paths should keep explicit owners.

## Automated quality

The required repository workflow is `.github/workflows/org-ci.yml`. It currently validates the plugin on Ubuntu and Windows and includes a robustness job covering Windows-style line endings and mutation testing.

Dependency automation is enabled for GitHub Actions through `.github/dependabot.yml`.

## Branch protection / ruleset target

The intended `main` policy is:

- pull request required;
- at least one approving review for team development;
- required CI checks before merge;
- conversation resolution before merge;
- no force-pushes or branch deletion;
- squash merge as the normal merge strategy.

This repository currently has **no repository rulesets configured**. GitHub branch-protection settings are an account-level administrative control and are not represented solely by files in the repository. Configure the ruleset in GitHub before treating the policy above as enforced.

Because the current repository is owned by a single account, make sure the required-review setting is compatible with the actual team membership before enabling it; otherwise legitimate maintenance PRs can be impossible to merge.

## Releases

Plugin behavior is versioned in `plugins/engineering-os/.claude-plugin/plugin.json` and documented in its `CHANGELOG.md`. Use Git tags/releases for distributable versions when the project moves from experimental to a published release process.

## Security

Use `SECURITY.md` for vulnerability reporting. Do not put credentials, private keys, or exploit details in public issues or pull requests.

## Maintenance cadence

Review at least monthly:

- stale branches and pull requests;
- dependency update PRs and security alerts;
- repository collaborators and permissions;
- CI failures and flaky tests;
- documentation drift;
- release/version consistency;
- open security and technical-debt issues.
