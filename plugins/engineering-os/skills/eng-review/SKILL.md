---
name: eng-review
description: F9 independent code review in a fresh context against requirements, design, tests, and security. PASS or CHANGES_REQUIRED.
argument-hint: [base-ref | commit-range | T-id]
context: fork
agent: engineering-os:code-reviewer
background: false
---
Independently review this change. Target: $ARGUMENTS
(If empty: all commits since the merge-base with the default branch, plus uncommitted changes.)

1. Establish the diff yourself with git. Don't rely on any summary or commit message.
2. Load only the relevant intent: the matching task and ACs in `docs/engineering/implementation-plan.md` / `status.md` / `requirements.md`, the relevant `architecture.md` section, and `decisions.md`. Missing artifacts are normal for SMALL changes; judge against the commit intent and the code.
3. If `.eng/evidence/verify-latest.json` exists, use its results. Re-run any check you doubt.
4. Review A–H, verify each finding with a concrete failure scenario, and approve when the change improves code health.
5. Format findings per `${CLAUDE_PLUGIN_ROOT}/templates/code-review.md`, condensed into your Handoff. STATUS is `PASS` or `CHANGES_REQUIRED`.
