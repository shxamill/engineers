---
name: eng-build
description: "F7-F8: dispatch the task-DAG frontier to capability agents (worktrees for parallel writers), verify handoffs, integrate, commit per task."
argument-hint: [T-ids | next-wave]
---
# Build and integrate (F7–F8)

**Target:** $ARGUMENTS (default: the `READY NOW` frontier)

1. **Frontier:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-plan-check.mjs" "${CLAUDE_PROJECT_DIR}/docs/engineering/implementation-plan.md"`. Dispatch only listed tasks, within the budget's concurrency.
2. **Direct or delegate:** do small tasks, or tasks whose context you already hold, yourself. Otherwise spawn `engineering-os:<owner>` with the delegation contract (`/engineering-os:eng` §5). Mark the task RUNNING in the plan.
3. **Isolation:** a single writer works in the main tree. Concurrent writers each get `isolation: "worktree"` and must commit on their worktree branch. Worktrees start from the default branch unless project settings set `worktree.baseRef: "head"` (recommended by eng-init); without it, give each writer the current branch name and have it merge that branch first.
4. **On each handoff:**
   - Check `git diff --stat` against CHANGED and the task's Files. Revert out-of-scope hunks.
   - Run the task's Verifier yourself (or `eng-verify --task T-n --only <kind>`). Pass → REVIEW (MEDIUM+) or DONE, with the evidence path in the Evidence column.
   - FAIL → increment Attempts; attempt 2 with the verifier errors in the prompt → change strategy (note it, reset Attempts) → `/engineering-os:eng-debug`. After the retry budget, mark it FAILED with the reason. A handoff cut off by the turn limit counts as FAIL: resume that agent rather than spawning a new one.
5. **Integrate worktrees one at a time:** `git merge --no-ff <branch>`, then `eng-verify targeted`.
   - Conflicts: resolve them yourself so both intents survive. Ask the owner, or the human, only when the intents truly conflict.
   - Then `git worktree remove <path>` and `git branch -d <branch>`.
6. **Commit per task:** `<type>(<scope>): <summary> [T-n]`, staging only that task's files.
7. **Update states** in implementation-plan.md (re-run plan-check) and status.md → Active work. New problems become new tasks, not silent fixes.

When the plan is DONE through build, continue the lifecycle: F9 judge/review → F10 security → F11 verify (`/engineering-os:eng` §3).
