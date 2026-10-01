---
name: eng-review
description: Independent code review in a fresh context by the code-reviewer agent. Reviews the actual diff against requirements, architecture, tests, security, and maintainability; returns PASS or CHANGES_REQUIRED. Gate G7.
argument-hint: [base-ref | commit-range | T-id]
context: fork
agent: code-reviewer
background: false
---
Independently review this change. Target: $ARGUMENTS
(If empty: all commits since the merge-base with the default branch, plus uncommitted changes.)

Follow your review procedure exactly:
1. Establish the diff yourself with git. Do not rely on any summary or commit message.
2. Load only the intent relevant to this diff: the matching task and ACs in `docs/engineering/status.md` / `implementation-plan.md` / `requirements.md`, the relevant `architecture.md` section, and `decisions.md`. Missing artifacts are normal for SMALL changes; judge against the commit intent and the code.
3. Review A–H, run the checks yourself, and verify each finding with a concrete failure scenario.
4. Format findings per `docs/engineering/templates/code-review.md`, condensed into your Handoff. STATUS is `PASS` or `CHANGES_REQUIRED`.
