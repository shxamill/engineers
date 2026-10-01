---
name: eng-build
description: Execute implementation-plan tasks - dispatch builder agents (in parallel worktrees when independent), verify each handoff, integrate branches, run checks, commit per task. Gate G6.
argument-hint: [T-ids | next-wave]
---
# Build & Integrate (Gate G6)

**Target:** $ARGUMENTS (default: the next ready wave in implementation-plan.md)

1. **Select** ready tasks (all dependencies done). A wave = ready tasks with disjoint file scopes.
2. **Direct or delegate.** Do it yourself when the task is small, or you already hold the needed context, or spawning would cost more context than it saves. Otherwise spawn the task's owner agent using the delegation contract (`/eng` §5).
3. **Isolation.** One writer at a time → work in the main tree. Two or more concurrent writers → each spawn uses `isolation: "worktree"` and must commit on its worktree branch.
4. **Verify each handoff** (never trust the summary):
   - `git diff --stat` (or `git diff --stat HEAD...<branch>`) matches CHANGED and the task scope; revert out-of-scope hunks.
   - Re-run the cheapest decisive VERIFY command yourself.
   - FAIL/BLOCKED → `/eng-debug` or re-delegate with the evidence and a sharper scope. Max 2 attempts per approach, then change approach.
5. **Integrate worktree branches one at a time:** `git merge --no-ff <branch>`, then run the fast checks (lint, typecheck, affected tests). Resolve conflicts yourself, preserving both intents; when intents truly conflict, ask the owning agent or the human. Then `git worktree remove <path>` and `git branch -d <branch>`.
6. **Commit per task** in the main tree: `<type>(<scope>): <summary> [T-n]` (types: feat, fix, refactor, test, docs, chore, perf, ci, build).
7. **Record:** mark the task done in implementation-plan.md and update status.md (Active work, Completed). New issues found → new tasks, not silent fixes.

When a wave is integrated and green, move on to the next wave, or to review (G7) when the plan is complete.
