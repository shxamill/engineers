---
name: eng-judge
description: "F9 intent/scope judge in a fresh context: request vs acceptance criteria vs actual diff vs tests. PASS or CHANGES_REQUIRED."
argument-hint: [T-id | base-ref]
context: fork
agent: engineering-os:scope-judge
background: false
---
Judge this change. Target: $ARGUMENTS (default: all changes since the merge-base with the default branch, plus uncommitted work).

1. Find the REQUEST and ACCEPTANCE CRITERIA: the matching task in `docs/engineering/implementation-plan.md`, else `docs/engineering/status.md` (Now/objective), else `docs/engineering/requirements.md`.
2. Establish the diff yourself (`git diff --stat`, then the hunks; `git status --short` for untracked files).
3. Read `.eng/evidence/verify-latest.json` (lines, tamper, warn) if present.
4. Answer the five questions in your instructions with file:line evidence, then return the Handoff with STATUS `PASS` or `CHANGES_REQUIRED`.
