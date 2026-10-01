# ADR-0002: Engineering OS v2 — plugin, capability routing, deterministic engines
_Status: accepted · Date: 2026-10-01 · Supersedes parts of ADR-0001 · Reversibility: easy (plugin versioned)_

## Context
The V1 audit (`docs/engineering/v2-audit.md`) found the org was project-local (copied into each repo), relied on CLAUDE.md and `.claude/rules` (which plugins can't ship), lacked a unified verifier, an intent judge, test-tamper detection, bounded agent turns, a machine-readable staffing model, outcome measurement, and repeatable benchmarks. Research (`docs/engineering/research.md`):
- Spotify Honk: verifiers and an LLM judge catch "passes CI but wrong" work and scope creep.
- Anthropic: multi-agent ≈15× tokens; keep context minimal.
- Stripe: deterministic steps, ≤2 CI rounds.
- METR: models tamper with tests.
- Team Topologies: stream-aligned teams plus enabling/platform support.
- DORA: instability rises with AI use.

## Decision
1. **Distribution:** `plugins/engineering-os/` plugin + repo marketplace. Product repos hold only settings and `docs/engineering/` state.
2. **Constitution by hook:** SessionStart and SubagentStart (`additionalContext`) inject a ≤45-line constitution, replacing CLAUDE.md. Path rules → conditional `standards-*` skills, preloaded into the relevant agents.
3. **Capabilities, not staff:** `routing/capabilities.yaml` (31 capabilities, Team Topologies type, budgets per class, risk requirements). `eng-route.mjs` returns class, budget, staff, and reviewers deterministically. 16 agents, each with `maxTurns`. Workers cannot spawn agents.
4. **Classification:** scope × risk (max over 9 dimensions) + flags. Risk adds gates, not headcount; critical risk → CRITICAL.
5. **Deterministic engines:** `eng-detect` (project adapter → `project-profile.json`), `eng-verify` (project checks + TESTS-TAMPER + SECRETS + SCOPE → compact verdict + evidence), `eng-plan-check` (task-DAG validation + ready frontier).
6. **Verification order:** deterministic verify → scope judge (sonnet, fresh) → code review (opus, fresh) → security review. A Stop hook blocks once when source changed after the last verification.
7. **Lifecycle F0–F16:** outcome evaluation (F15) is separate from deployment (F14). A poor outcome re-enters discovery.
8. **Security boundary:** native permissions + OS sandbox (recommended by `eng-init`) are the boundary; hooks are defense in depth. Gated actions use native `ask`.
9. **Benchmarks:** native `claude plugin eval` cases (15 scenarios) with deterministic graders + LLM judges.
10. **Agent teams:** off by default; 3–5 teammates only for LARGE/CRITICAL independent streams.

## Alternatives considered
| Option | Why not |
|---|---|
| Keep the project-local org, copied per repo | Contaminates product repos; no versioning/updates |
| Ship rules via `/eng-init` copying `.claude/rules` | Writes OS internals into products; drifts from plugin version |
| Model-only routing (no registry/router) | Inconsistent staffing; costs tokens on every request |
| Custom benchmark harness | Native `plugin eval` already has scaffolds, graders, cost ceilings, ablation |
| Opus everywhere | Cost without evidence of benefit for mechanical or implementation work |

## Consequences
- Always-on context measured by `claude plugin details`: ~2.15k tokens + ~0.6k injected constitution.
- Each new agent or capability must pass the registry⇄agent drift checks in the validator.
- The eval runner requires an OS sandbox backend for shell tools (Linux: bubblewrap + socat).
- Correction to ADR-0001: subagents *can* spawn subagents (default depth 3). The orchestrator stays in the main session for control, and workers are denied the Agent tool by construction.
