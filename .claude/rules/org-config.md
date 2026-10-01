---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "scripts/validate-org.mjs"
  - "scripts/verify-hooks.mjs"
---
# Changing the engineering org itself
- Put each instruction in the cheapest place that works:
  universal rule → `CLAUDE.md` (loaded into every context, including subagents; keep ≤80 lines) ·
  role behavior → `.claude/agents/<role>.md` · workflow → `.claude/skills/<name>/SKILL.md` ·
  file-type rule → `.claude/rules/*.md` with `paths:` · deterministic enforcement → a hook in `.claude/hooks/` wired in `.claude/settings.json`.
- Agent and skill descriptions are always in context: one or two sentences saying what and when (≤300 chars).
- Don't duplicate content between CLAUDE.md, skills, and agents; reference instead.
- Hooks: Node, zero dependencies, cross-platform; fail open on internal errors; exit 2 only for deliberate blocks. Add test cases to `scripts/verify-hooks.mjs` for every new behavior.
- Prefer native Claude Code mechanisms (permissions, frontmatter fields) over custom scripts.
- Skills, rules, and hooks reload in a running session; new or changed agents take effect only in a new session. Test agent changes with a fresh session or `claude -p --agent <name>`.
- After any change: `node scripts/validate-org.mjs && node scripts/verify-hooks.mjs`, and log a `PROC-n` entry in `docs/engineering/decisions.md`.
