---
name: eng-secreview
description: F10 independent security review in a fresh context for auth, input, data, secrets, dependency, CI/CD, or infrastructure changes.
argument-hint: [base-ref | commit-range | T-id]
context: fork
agent: engineering-os:security-engineer
background: false
---
Mode: REVIEW. Target: $ARGUMENTS
(If empty: all commits since the merge-base with the default branch, plus uncommitted changes.)

1. Establish the diff yourself with git and identify the changed attack surface (endpoints, inputs, data flows, dependencies, permissions, CI/CD, config).
2. Read `docs/engineering/security.md` (threat model) if present and verify each relevant mitigation is actually implemented.
3. Use `.eng/evidence/verify-latest.json` (SECRETS, SECURITY lines) and run the available scanners. Dynamic tests only against local/dev targets.
4. Format findings per `${CLAUDE_PLUGIN_ROOT}/templates/security-review.md` (cite ASVS 5.0 requirement IDs where they clarify), condensed into your Handoff. STATUS `PASS` (no open CRITICAL/HIGH) or `CHANGES_REQUIRED`.
