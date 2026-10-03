---
name: eng-status
description: "Current engineering state: class, phase, tasks, active agents, verification, reviews, security, release, outcome, gate preview, cost counters. Cheap; spawns no agents."
argument-hint: "[--metrics]"
---
# Status

1. Run the deterministic report (no model gathering needed):
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-status.mjs" "${CLAUDE_PROJECT_DIR}" $ARGUMENTS`
   It prints PROJECT, OBJECTIVE, CLASS/RISK/FLAGS/PHASE, TASKS (plan-check), AGENTS (active = spawned without a handoff), BLOCKERS, VERIFICATION (current content or STALE), REVIEWS, GATE (what the Stop gate would say now), SECURITY, RELEASE, OUTCOME, COST counters (from `.eng/telemetry.jsonl`), NEXT. `--metrics` prints the full telemetry aggregate as JSON (for retrospectives).
2. If `docs/engineering/status.md` is missing, create it from `${CLAUDE_PLUGIN_ROOT}/templates/status.md`.
3. Reconcile status.md in place only where the report shows drift:
   - tasks merged but still marked active → Completed
   - flag stale worktrees (`git worktree list`) and blockers
   - keep only the last 10 entries under Completed
4. Relay the report as-is (≤16 lines). Add one line only if something needs the human: a blocker, a gate that can't be satisfied, or a decision from the human-gate list.
