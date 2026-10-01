---
name: eng-status
description: "Current engineering state: phase, task-DAG frontier, last verification, blockers, next action. Cheap; spawns no agents."
---
# Status

1. Gather:
   - `docs/engineering/status.md` (create it from `${CLAUDE_PLUGIN_ROOT}/templates/status.md` if missing)
   - `git status --short | head -20`, `git log --oneline -8`, `git worktree list`
   - if a plan exists: `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-plan-check.mjs"`
   - the first lines of `.eng/evidence/verify-latest.json` (verdict, time)
2. Reconcile status.md in place:
   - tasks merged but still marked active → Completed
   - flag stale worktrees and blockers
   - keep only the last 10 entries under Completed
3. Print ≤15 lines:
   ```
   Objective / Class / Phase
   Phases: F0✓ F2✓ F4… (✓ done · … in progress · ✗ failed · – skipped by decision)
   Plan: <counts by state> · READY NOW: <ids>
   Last verify: <verdict> (<time>)
   Blockers / Risks: <top items>
   Next: <single next action>
   ```
