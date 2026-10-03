---
name: eng-init
description: "One-time project adapter: detect stack and verification commands into project-profile.json, create engineering state, recommend permissions and sandbox."
---
# Project adapter (once per project)

1. **Detect** (offline, deterministic):
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-detect.mjs" "${CLAUDE_PROJECT_DIR}" --write`
   Review the printed CHECKS. If a command is wrong or missing, add it under `"overrides": {"checks": [{"id","kind","cmd","cwd"}], "disable": ["id"], "notApplicable": {"<kind>": "<reason>"}}` in `docs/engineering/project-profile.json` (`notApplicable` only for kinds that genuinely don't apply, e.g. typecheck for plain JS). Overrides survive re-detection.
2. **State:** if missing, create `docs/engineering/status.md` from `${CLAUDE_PLUGIN_ROOT}/templates/status.md` and `docs/engineering/decisions.md` (a one-line header plus a table). Add `.eng/` to `.gitignore` if absent.
3. **Baseline:** run `/engineering-os:eng-verify targeted` once and record the result under status.md → Checks. A red baseline is a pre-existing condition; note it so later work isn't blamed for it.
4. **Security settings:** plugins cannot ship permissions or sandbox, so they belong in project settings. Show the human the recommended block from `${CLAUDE_PLUGIN_ROOT}/templates/project-settings.json`:
   - the deny rules for secret files (safe, low friction);
   - `worktree.baseRef: "head"`, so subagent worktrees start from the current branch instead of the default branch (parallel builds on an `eng/<slug>` branch need the earlier waves' commits);
   - the OS sandbox (`sandbox.enabled`), which changes how every shell command runs. It runs on macOS, Linux, and WSL2, not native Windows; confirm availability with `/sandbox`.
   Ask once (AskUserQuestion: apply all / all except the sandbox / skip). Merge the chosen block into `.claude/settings.json` without removing existing keys.
5. Report: stack line, checks, gaps (no tests, no typecheck, no CI), baseline verdict, settings applied.
