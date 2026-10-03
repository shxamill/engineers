# Repository maintenance runbook

This runbook describes how to maintain **GitHub repository health around Engineering OS** without modifying the product/plugin implementation unless a separate engineering change is explicitly requested.

## Non-negotiable boundary

Repository maintenance must not change:

- plugin behavior;
- source implementation;
- hooks, agents, skills, routing, or engine logic;
- tests or evaluation behavior;
- existing workflows or deployment logic.

Maintenance may add or update repository-governance material such as documentation, issue/PR templates, CODEOWNERS, Dependabot configuration, security-policy files, and other clearly non-product metadata. Any change that could alter execution behavior belongs in a normal engineering change with review and verification.

## Repository state snapshot

This is a point-in-time maintenance snapshot, not a live status source. Re-run the repository-state checks during each maintenance cycle.

As of 2026-10-03:

- Repository: shxamill/engineers
- Default branch: main
- Visibility: public
- Product/plugin version: 3.0.0
- Open issues: #4 (GitHub admin hardening)
- Open pull requests: none
- Repository rulesets: none configured at snapshot time
- GitHub Releases: none; no v3.0.0 tag yet
- Existing branches: main plus two Claude-generated branches under review/cleanup
- Existing CI: .github/workflows/org-ci.yml
- Latest main CI observed during this snapshot: green on Ubuntu, Windows, and robustness
- Existing project engineering records: docs/engineering/
- Existing contributor guidance: CONTRIBUTING.md


The repository contains additional Claude-generated branches. Do not delete a branch merely because it is old; first verify whether it contains unique commits or unfinished work. The audit found branches that diverge from main, so they are intentionally left untouched.

## Maintenance cadence

### On every repository change

Check:

- PR description explains purpose, scope, validation, and risk;
- CI result is understood;
- no secrets or sensitive data were introduced;
- changed files stay within the declared scope;
- documentation stays consistent with behavior.

### Weekly

Review:

- open pull requests;
- new issues;
- failing CI runs;
- Dependabot pull requests and security alerts;
- newly reported discussions;
- branches older than expected.

Do not mass-delete branches. Investigate before deletion.

### Monthly

Review:

- repository access and collaborators;
- branch/ruleset configuration;
- CODEOWNERS coverage for sensitive paths;
- Dependabot health;
- secret-scanning and code-scanning alerts;
- documentation drift;
- release/tag consistency;
- stale issues and pull requests;
- dependency and GitHub Actions update backlog;
- whether the repository still needs its current integrations.

### Before a release

Review:

1. Current version and changelog.
2. Release notes and user-visible changes.
3. CI status on the exact commit being released.
4. Security alerts relevant to the release.
5. Migration/compatibility notes where needed.
6. Rollback or recovery notes.
7. Git tag and GitHub Release metadata.

Do not create or publish a release merely because a version number changed in a file. Release readiness should be established from the exact commit and evidence for that release.

## Branch hygiene

Preferred working branches use intent-based names:

- feat/<slug>
- fix/<slug>
- refactor/<slug>
- docs/<slug>
- chore/<slug>
- hotfix/<slug>

Keep branches short-lived where practical. Before deleting a branch:

1. Compare it to main.
2. Confirm whether its commits are merged or intentionally superseded.
3. Check for an open PR or a useful unmerged change.
4. Only then delete it.

Never rewrite shared history as a cleanup method.

## Pull request hygiene

A healthy PR should have:

- one coherent purpose;
- a useful title;
- a linked issue when there is tracked work;
- validation evidence;
- explicit risk/rollback notes when relevant;
- reviewers appropriate to changed paths;
- no unrelated cleanup.

Keep the PR body accurate after subsequent pushes.

## CI hygiene

The repository currently has a dedicated org-ci workflow. Maintenance should monitor its reliability rather than casually rewriting it.

When a CI failure appears:

1. Determine whether it is a product regression, infrastructure/transient failure, or test-environment issue.
2. Read the relevant job logs.
3. Re-run only when a transient failure is plausible.
4. Record recurring failures as engineering work instead of repeatedly ignoring them.
5. Do not weaken checks just to turn CI green.

The existing workflow already uses a read-only top-level token permission and pins its checkout action to a full commit SHA. Preserve those properties when reviewing future workflow changes.

## Dependency hygiene

Dependabot is configured for GitHub Actions. Review update pull requests routinely.

When new ecosystems are actually introduced to the repository, extend dependabot.yml to the real package manager and manifest location. Do not add guessed ecosystems for technologies that are not present.

Security updates should be treated separately from routine version updates: assess impact, run the repository's checks, and merge through the normal review path.

## Security hygiene

At minimum, keep these repository controls under review:

- secret scanning;
- push protection;
- Dependabot alerts/security updates;
- code scanning where supported and appropriate;
- private vulnerability reporting;
- minimal GitHub Actions token permissions;
- pinned third-party Actions;
- safe workflow triggers and untrusted-input handling.

Never put credentials or private keys into git history.

## Governance settings

The intended main policy is documented in github-governance.md. The policy is only real when enforced in GitHub settings.

Target controls:

- pull request required;
- required CI checks;
- at least one approval for team development;
- Code Owner review for owned paths;
- conversation resolution;
- no force pushes;
- no branch deletion;
- no unnecessary bypass actors;
- squash merge as the normal path.

Because this repository is currently owned by a single GitHub account, do not enable a required-review policy that makes the repository impossible for its actual maintainers to merge. Revisit the policy when the repository moves to an organization with real engineering teams.

## Community health

Keep these files current:

- README.md
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- SECURITY.md
- SUPPORT.md
- .github/pull_request_template.md
- .github/ISSUE_TEMPLATE/*
- .github/CODEOWNERS

The repository is licensed under MIT. Keep the root [LICENSE](../../LICENSE) file and the plugin manifest's `"license": "MIT"` declaration consistent.

## Maintenance principle

The maintainer's job is not to constantly change the repository. The job is to keep the repository **safe, understandable, reviewable, reproducible, and current**, while preserving the product exactly unless an engineering change is intentionally requested.
