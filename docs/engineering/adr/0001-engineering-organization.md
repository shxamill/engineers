# ADR-0001: Structure of the virtual engineering organization
_Status: accepted · Date: 2026-10-01 · Deciders: product owner (requested), orchestrator (designed) · Reversibility: easy_

## Context
The goal is an autonomous engineering organization in Claude Code that takes a high-level goal through a professional lifecycle with strong verification and minimal wasted context. Facts verified against the installed CLI (Claude Code 2.1.286):
- Subagents cannot spawn subagents, so orchestration must live in the main session.
- Subagents load CLAUDE.md by default (opt-out: `omitClaudeMd`). Every agent and skill description is listed in every session.
- Skills support `context: fork` + `agent:` (run in a fresh subagent context) and `background: false` (wait inline). Forks default to background.
- `.claude/rules/*.md` with `paths:` load only when matching files are touched.
- Hooks receive `agent_type` and `last_assistant_message` on SubagentStop; exit code 2 blocks with feedback.
- The user works mainly on Windows; Node is present on all target machines (JS/TS/MERN stack). The PowerShell tool exists on Windows.

## Decision
1. **Main session = CTO Orchestrator**, driven by the `/eng` skill (classification, rigor matrix, staffing, delegation contract, gates). TPM duties stay with it because the dependency graph is needed where dispatch happens.
2. **29 roles → 15 agents**, grouped by shared method and context (see README org chart). Least-privilege tools per agent; reviewers are read-only.
3. **14 workflow skills** (`eng-*`), loaded only when a phase runs. Review and security review run as forked skills, in a fresh context by construction.
4. **Path-scoped rules** for frontend, backend, data, security-sensitive, testing, infra, engineering docs, and org config. Nothing in rules is always-loaded.
5. **Deterministic enforcement via Node hooks**: destructive/irreversible command gating, secrets protection, auto-format, handoff/evidence contract, session state injection. Native permission deny rules are added as defense in depth.
6. **Durable state in `docs/engineering/`**, created lazily from templates. `status.md` → Now is injected each session.
7. **Model tiering** in agent frontmatter (opus for judgment-heavy roles, sonnet for builders, haiku for docs), with orchestrator overrides (escalate to `fable`).
8. **Focused subagents, not agent teams**, by default.

## Alternatives considered
| Option | Why not chosen |
|---|---|
| One agent file per role (29 agents) | ~2× always-loaded description cost; many roles share the same method; more routing ambiguity |
| Orchestrator as a custom agent (`--agent cto`) | It would need special launch flags, and the main session must orchestrate anyway since subagents can't nest |
| Everything in CLAUDE.md | Loaded into every subagent; would cost thousands of tokens per spawn |
| Agent teams (experimental) | Higher context cost; artifact-based handoffs suffice for current scale |
| Bash/Python hooks | Bash is unreliable on Windows; `python` vs `python3` differs across machines; Node is guaranteed for this user |
| Pre-creating all artifacts as empty files | Empty shells mislead readers and invite filler; templates + lazy creation keep every file meaningful |

## Trade-offs
- Consolidated agents carry broader prompts than single-role agents; mitigated by focused delegation contracts and path rules.
- The bash guard uses heuristics: it can false-positive on commands that merely mention dangerous text (e.g. inline test fixtures), and it cannot catch every obfuscated command. It is a safety net, not a sandbox.
- The approval marker relies on agent honesty; it is visible in the transcript for audit.

## Consequences
- Adding a role = add an agent file + one README/`/eng` table row; validated by `scripts/validate-org.mjs`.
- Revisit agent splits (e.g. a dedicated data-engineer) when retrospectives show a consolidated agent underperforming.
- Revisit agent teams if a LARGE project needs live cross-specialist debate.
