# Engineering Organization — Operating Manual

A virtual engineering org running inside Claude Code. You give a goal; the **CTO Orchestrator** (the main Claude session) classifies it, staffs only the specialists it needs, drives it through gated phases, and reports with evidence.

## Quick start
| You type | What happens |
|---|---|
| `/eng <goal>` | Full lifecycle, scaled to risk: intake → spec → design → architecture → security → plan → build → review → verify → release → learn |
| `/eng-intake <request>` | Classify and frame only (TRIVIAL / SMALL / MEDIUM / LARGE / CRITICAL) |
| `/eng-research <questions>` | Targeted, deduplicated research → `research.md` |
| `/eng-spec` | Requirements + acceptance criteria (+ UX spec for UI) |
| `/eng-arch` | Architecture, ADRs, threat model |
| `/eng-plan` | Task decomposition into parallel waves |
| `/eng-build [T-ids]` | Dispatch builders, integrate, verify |
| `/eng-test` | Layered verification, coverage gaps, adversarial QA |
| `/eng-review [base]` | Independent code review in a fresh context |
| `/eng-secreview [base]` | Independent security review in a fresh context |
| `/eng-debug <symptom>` | Forensic root-cause debugging |
| `/eng-release [env]` | Readiness, gated deploy, post-deploy verification, rollback |
| `/eng-status` | Current phase, gates, blockers, next action |
| `/eng-retro` | Retrospective/postmortem + process improvements |

The rigor matrix (which phases and gates apply per class) lives in `.claude/skills/eng/SKILL.md` §3. A typo goes straight to a fix and a check; a payment system gets every gate.

## Org chart: 29 roles → 15 agents + orchestrator
Roles are responsibilities; agents are the minimal set of contexts that carry them. Each agent description costs context in every session, so overlapping roles share an agent (ADR-0001).

| Role | Carried by |
|---|---|
| Engineering Director / CTO, Technical Program Manager | main session via `/eng`, `/eng-plan` |
| Principal / Staff Architect | `architect` |
| Product Manager, Product Analytics | `product-manager` |
| Product Researcher | `researcher` |
| UX Designer, UI/Visual Designer, Design Systems | `ux-designer` (spec) · `frontend-engineer` (implementation) |
| Frontend Engineer, Mobile Engineer | `frontend-engineer` |
| Backend Engineer, Database/Data Engineer, Integration Engineer | `backend-engineer` |
| AI/ML Engineer | `ai-engineer` |
| DevOps/Platform Engineer, Release Engineer | `platform-engineer` |
| SRE, Performance Engineer | `reliability-engineer` |
| QA Engineer, Test Automation Engineer | `test-engineer` |
| Independent Code Reviewer | `code-reviewer` (read-only, via `/eng-review`) |
| Adversarial QA / Red Team | `adversarial-qa` (read-only) |
| AppSec, Security Testing, Privacy/Compliance, Supply-Chain Security | `security-engineer` (+ `platform-engineer` for build hardening) |
| Debugging / Incident Engineer | `debugger` |
| Documentation / DX Engineer | `tech-writer` |

**Model tiering:** opus for architect, security, review, and debugging; sonnet for builders, research, PM, and UX; haiku for docs; the built-in `Explore` agent for broad code search. The orchestrator escalates the hardest CRITICAL work to `fable` when available.

## Artifacts (`docs/engineering/`) — created on first need, never as empty shells
| File | Purpose | Written by | When |
|---|---|---|---|
| `status.md` | Live state; its Now section is auto-injected each session | orchestrator | always |
| `decisions.md`, `adr/` | Durable decisions, process changes (PROC-n) | architect, orchestrator | any durable decision |
| `product.md` | Working-backwards product brief | orchestrator / product-manager | MEDIUM+ new product or feature |
| `research.md` | Reusable, dated, sourced findings | researcher | when research ran |
| `requirements.md` | FR / NFR / AC / out-of-scope / metrics | product-manager | MEDIUM+ |
| `ux.md` | Flows, screens, states, a11y, tokens | ux-designer | user-facing MEDIUM+ |
| `architecture.md` | The actual system (PLANNED items marked) | architect | MEDIUM+ |
| `security.md` | Threat model, data classification | security-engineer | risk flags / MEDIUM+ with data |
| `implementation-plan.md` | Tasks, owners, waves | orchestrator | MEDIUM+ |
| `test-plan.md` | AC → test → result | test-engineer | MEDIUM+ |
| `release-plan.md` | Readiness, rollout, rollback, verification | platform-engineer / orchestrator | when releasing |
| `retrospectives/` | Lessons and postmortems | orchestrator | after MEDIUM+ / incidents |
| `templates/` | Starting points for all of the above | — | — |

Large evidence (logs, scans, profiles) goes to `.eng/evidence/` (gitignored); artifacts link to it.

## Enforcement layer (deterministic, in `.claude/hooks/`)
| Hook | Event | Does |
|---|---|---|
| `session-context.mjs` | SessionStart (also after compaction) | Injects branch, uncommitted count, and status.md → Now so work resumes from state, not chat |
| `guard-bash.mjs` | PreToolUse Bash/PowerShell | Blocks catastrophic commands outright; gates destructive or irreversible ones (force push, `reset --hard`, DROP, terraform destroy, prod deploys, publish, `curl \| sh`, reading secrets) behind human approval |
| `guard-secrets.mjs` | PreToolUse Read/Edit/Write | Blocks reading or writing secret files and writing credential-shaped strings |
| `format-edited.mjs` | PostToolUse Edit/Write | Runs the project's own formatter (prettier/biome/ruff/black/gofmt/rustfmt) if configured |
| `check-handoff.mjs` | SubagentStop | Org agents must return the Handoff; `PASS` without `EVIDENCE` is rejected |

**Human approval:** when a gated command is genuinely approved by you in the conversation, the agent re-runs it with the marker `ENG_HUMAN_APPROVED=1`, which stays visible in the transcript. Catastrophic commands (`rm -rf /`, disk formatting) have no override.

## Extending the org (self-improvement)
- Repeated failure → `/eng-retro` → fix the mechanism (skill checklist, path rule, hook, staffing rule), log `PROC-n` in `decisions.md`.
- Where things go: universal → `CLAUDE.md` (keep it tiny) · role → `.claude/agents/` · workflow → `.claude/skills/` · file-type rule → `.claude/rules/` (`paths:` frontmatter) · enforcement → hook.
- Validate after every change: `node scripts/validate-org.mjs && node scripts/verify-hooks.mjs` (CI runs both).
- Skills, rules, and hooks reload live; new agents can take a while to appear in a running session (a new session always has them).

## Using it in another repository
Copy `CLAUDE.md`, `.claude/`, `scripts/validate-org.mjs`, `scripts/verify-hooks.mjs`, `docs/engineering/README.md`, and `docs/engineering/templates/` into the target repo, then run `/eng-status` to create `status.md`. Requires Node 18+ on PATH (hooks are dependency-free Node scripts that work on Windows, macOS, and Linux).

## Agent teams
Not enabled. Focused subagents plus artifact-based handoffs cover current needs at lower context cost. Revisit (ADR-0001) if a LARGE project needs live peer-to-peer debate between specialists.
