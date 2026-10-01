---
name: eng-plan
description: "F6: decompose requirements and architecture into a validated task DAG (capability, files, dependencies, verifier, state, waves)."
argument-hint: [scope]
---
# Implementation plan (F6) — you act as TPM

**Scope:** $ARGUMENTS

Write `docs/engineering/implementation-plan.md` from `${CLAUDE_PLUGIN_ROOT}/templates/implementation-plan.md`. The task table is the runtime task database (not the chat):

`| ID | Objective | Capability | Owner | Depends | Wave | Files | Verifier | Risk | State |`

Rules:
- **Vertical slices** that deliver verifiable behavior ("user registration endpoint + persistence + tests"), never layers ("build the backend").
- **New project:** T-1 is a walking skeleton (scaffold, one end-to-end path, test runner, lint/typecheck, CI).
- **Bounded:** one builder session per task (~≤10 files). Bigger → split.
- **Capability** = a registry id (`routing/capabilities.yaml`) or `orchestrator` for work you'll do yourself. Owner = `engineering-os:<agent>`.
- **Files** = explicit globs. Tasks in the same wave must not overlap (the checker enforces this).
- **Verifier** = the command or check that proves the task (`eng-verify --only test`, a specific test file, a curl smoke check).
- **Include non-feature work:** threat-model mitigations, observability, migrations + rollback, docs, release prep.
- **Order:** riskiest unknowns first (time-boxed spikes allowed), then the core path, then breadth.
- **States:** READY → RUNNING → REVIEW → VERIFICATION → DONE, or BLOCKED / FAILED (with a reason in the task notes).

Validate (must PASS before building):
`node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-plan-check.mjs" "${CLAUDE_PROJECT_DIR}/docs/engineering/implementation-plan.md"`
It prints errors (cycles, unknown deps, same-wave file overlap, bad states) and `READY NOW` (the dispatchable frontier). Also check that every AC maps to at least one task. Record the waves in status.md → Active work.
