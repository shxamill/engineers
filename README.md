# engineers

A production-grade virtual engineering organization for Claude Code. Give it one high-level goal; it classifies the work, staffs only the specialists it needs, and drives the work through requirements, design, architecture, security, planning, build, independent review, verification, release, and learning, with evidence at every gate.

## Use it
Open this repo in Claude Code (CLI, desktop, web, or VS Code) and type:

```
/eng Build me a SaaS application for <X>
```

Other entry points: `/eng-status`, `/eng-debug <symptom>`, `/eng-review`, and the rest listed in the [operating manual](docs/engineering/README.md).

## What's inside
| Path | Contents |
|---|---|
| `CLAUDE.md` | The constitution: universal rules, human decision gates, handoff contract |
| `.claude/agents/` | 15 specialist agents covering 29 engineering roles |
| `.claude/skills/` | `/eng` orchestrator + 13 phase workflows |
| `.claude/rules/` | Path-scoped engineering rules (load only for matching files) |
| `.claude/hooks/` + `.claude/settings.json` | Deterministic guardrails: destructive-command gate, secrets guard, formatter, evidence check, session state |
| `docs/engineering/` | Durable project state, decisions, templates |
| `scripts/` | `validate-org.mjs` (config validator), `verify-hooks.mjs` (hook test suite) |

## Requirements
Claude Code 2.1+ and Node.js 18+ on PATH (Windows, macOS, or Linux).

## Verify the org
```
node scripts/validate-org.mjs
node scripts/verify-hooks.mjs
```
Run from the repo root in any terminal (PowerShell, bash, or zsh). CI runs both on every push.
