---
name: eng-plan
description: Decompose the approved spec and architecture into small, independently verifiable tasks with owners, dependencies, acceptance criteria, tests, and parallel waves (implementation-plan.md). Gate G5.
argument-hint: [scope]
---
# Implementation Plan (Gate G5) — you act as TPM

**Scope:** $ARGUMENTS

Write `docs/engineering/implementation-plan.md`, with tasks in the format of `docs/engineering/templates/task.md`.

## Decomposition rules
- **Vertical slices** that deliver verifiable behavior, not horizontal layers ("all models", then "all APIs").
- **New project:** T-1 is a walking skeleton: repo scaffold, one trivial end-to-end path, test runner, lint/typecheck, CI. Everything else builds on it.
- **Bounded size:** each task fits one builder session (roughly ≤10 files changed); bigger → split.
- **Explicit file scope** per task. Tasks in the same wave must have disjoint scopes.
- **Every task** has an owner (agent name, or `orchestrator` for work you'll do directly), dependencies, ACs (linked AC-n), required tests, and an exit condition.
- **Include the non-feature work:** security mitigations from `security.md`, observability, migrations with rollback, docs, release prep.
- **Order:** riskiest unknowns early (spikes are allowed and time-boxed), then the core path, then breadth.

## Output
1. A wave table: `Wave | Tasks (parallel) | Depends on`.
2. Task blocks.
3. Gate G5 check: every AC is covered by some task; dependencies are acyclic; no two parallel tasks share files.
4. status.md → Active work lists wave 1.
