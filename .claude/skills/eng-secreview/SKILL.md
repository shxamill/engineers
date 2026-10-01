---
name: eng-secreview
description: Independent security review in a fresh context by the security-engineer agent, for changes touching auth, input handling, data, secrets, dependencies, CI/CD, or infrastructure. Severity-classified findings. Gate G7 (security).
argument-hint: [base-ref | commit-range | T-id]
context: fork
agent: security-engineer
background: false
---
Mode: REVIEW. Target: $ARGUMENTS
(If empty: all commits since the merge-base with the default branch, plus uncommitted changes.)

1. Establish the diff yourself with git and identify the changed attack surface: new or changed endpoints, inputs, data flows, dependencies, permissions, config.
2. Read `docs/engineering/security.md` (threat model) if present, and verify each relevant mitigation is actually implemented.
3. Run your review checklist and any scanners available in the project. Dynamic testing only against local/dev targets.
4. Format findings per `docs/engineering/templates/security-review.md`, condensed into your Handoff. STATUS is `PASS` (no open CRITICAL/HIGH) or `CHANGES_REQUIRED`.
