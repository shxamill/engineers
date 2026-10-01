---
name: eng-status
description: Report current engineering state - phase, objective, gates, active work, blockers, risks, next actions - after reconciling status.md with git. Cheap; spawns no agents.
---
# Status

1. Gather: `docs/engineering/status.md` (create it from `docs/engineering/templates/status.md` if missing), `git status --short | head -20`, `git log --oneline -8`, `git worktree list`.
2. Reconcile and fix status.md in place: tasks marked active but already merged → Completed; stale worktrees or blockers → flag; Completed keeps only the last 10 entries.
3. Print ≤15 lines:
   ```
   Objective / Class / Phase
   Gates: G0✓ G1✓ G2– G3… (✓ passed, … in progress, ✗ failed, – not required)
   Active: <task — owner — state>
   Blockers / Risks: <top items>
   Next: <single next action>
   ```
