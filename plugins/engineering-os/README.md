# Engineering OS (Claude Code plugin) — Operating Manual

An engineering organization operated by AI. You give a goal; the **CTO orchestrator** (your main Claude session) classifies it, routes it to the minimum capable team from a capability registry, and drives an adaptive lifecycle from discovery to measured outcome. Deterministic engines and hooks do the mechanical work. Progress needs evidence at every gate.

## Install (per project)
```
/plugin marketplace add shxamill/engineers
/plugin install engineering-os@engineers
/engineering-os:eng-init
```
Or commit this to the product repo's `.claude/settings.json` so the whole team gets it:
```json
{ "extraKnownMarketplaces": { "engineers": { "source": { "source": "github", "repo": "shxamill/engineers" } } },
  "enabledPlugins": { "engineering-os@engineers": true } }
```
The product repo keeps only project state: `docs/engineering/` (status, plan, decisions, profile, …) and `.eng/evidence/` (gitignored). No OS internals are copied in.

Requirements: Claude Code 2.1+ and Node.js 18+ on PATH (Windows, macOS, Linux).

## Use
| Command | Phase | What happens |
|---|---|---|
| `/engineering-os:eng <goal>` | all | Full adaptive lifecycle, scaled to class and risk |
| `/engineering-os:eng-init` | setup | Detect stack and checks → `project-profile.json`; recommend permissions and sandbox |
| `/engineering-os:eng-intake` | F0–F1 | Scope × risk classification, routing, discovery brief |
| `/engineering-os:eng-research` | F1 | Deduplicated, sourced research |
| `/engineering-os:eng-spec` | F2–F3 | Requirements with verification methods, UX spec |
| `/engineering-os:eng-arch` | F4–F5 | Architecture, ADRs, threat model |
| `/engineering-os:eng-plan` | F6 | Task DAG validated by `eng-plan-check` |
| `/engineering-os:eng-build` | F7–F8 | Dispatch the frontier, worktrees for parallel writers, integrate |
| `/engineering-os:eng-judge` | F9 | Cheap intent/scope judge (fresh context) |
| `/engineering-os:eng-review` | F9 | Independent code review (fresh context) |
| `/engineering-os:eng-test` | F9/F11 | AC→test coverage, adversarial QA |
| `/engineering-os:eng-secreview` | F10 | Independent security review |
| `/engineering-os:eng-verify` | F11 | Run all project checks + tamper/secret/scope checks → compact verdict |
| `/engineering-os:eng-debug` | any | Forensic root-cause loop with retry budget |
| `/engineering-os:eng-release` | F12–F14 | Readiness, gated deploy, post-deploy verification, rollback |
| `/engineering-os:eng-outcome` | F15 | Did the intended outcome happen? (separate from "deployed") |
| `/engineering-os:eng-retro` | F16 | Blameless retro; generalizable lessons improve the OS |
| `/engineering-os:eng-status` | any | Phase, DAG frontier, last verification, next action |

## Organization model
Capabilities, not permanent staff. 31 capabilities in 8 groups (product, design, software, platform, quality, security, knowledge, plus architecture) live in `routing/capabilities.yaml`. They map onto **16 agents** (fewer, deeper contexts), each tagged with a Team Topologies role:
- **Stream-aligned (value delivery):** product-management, ux/ui, frontend, backend, database, mobile, integrations.
- **Enabling (specialist support):** architecture, research, QA, code-review, scope-judge, adversarial QA, debugging, AppSec, threat modeling, privacy, supply chain, SRE, performance, documentation.
- **Platform:** devops, platform engineering, release, design systems, test automation, DX.
- **Complicated subsystem:** AI/ML.

The orchestrator is the value-delivery cell's owner and integrator. Specialists join only when routing (triggers, risk flags, class budget) says they add confidence.

## Staffing and budgets (`eng-route.mjs`)
| Class | Spawned agents | Concurrency | Research | Retries/approach | Verify | Default reviewers |
|---|---|---|---|---|---|---|
| TRIVIAL | 0 | 0 | none | 1 | targeted | self-check |
| SMALL | ≤1 | 1 | none | 2 | standard | code-review |
| MEDIUM | ≤4 | 2 | quick | 2 | standard | scope-judge, code-review |
| LARGE | ≤8 | 4 | standard | 2 | full | + adversarial QA |
| CRITICAL | ≤10 | 3 | standard | 2 | full | + AppSec |
Risk flags add mandatory capabilities (e.g. `auth` → threat modeling + AppSec). Class = scope; critical risk → CRITICAL; high risk is never TRIVIAL. Risk adds gates, not headcount. Agent teams are off by default (3–5 teammates when justified).

## Token and context strategy
- **Always loaded:** a ~40-line constitution (injected by hook, since plugins can't ship CLAUDE.md) + skill/agent descriptions. Run `claude plugin details engineering-os` for the current projected cost.
- **On demand:** phase skills; `standards-*` skills activate only when matching files are touched, or are preloaded into the relevant agents.
- **Deterministic engines instead of model reasoning:** routing, stack detection, verification, DAG validation, tamper and secret scans. Their compact output replaces exploration and long logs.
- **Durable state in files:** status Now (injected each session), plan states, decisions, project profile, evidence paths.
- **Bounded:** every agent has `maxTurns`; retry budgets per class; models tiered by reasoning need.

## Verification model
1. Deterministic: `eng-verify` runs the project's own build/lint/format/typecheck/tests/e2e/audits from the profile, plus TESTS-TAMPER (deleted tests, new skip/only, fewer assertions), SECRETS (diff scan), and SCOPE. NOT_RUN is never reported as PASS.
2. Intent: `eng-judge` (scope-judge agent) checks request ⇄ ACs ⇄ diff ⇄ tests.
3. Engineering: `eng-review` (opus, fresh context); approves when code health improves.
4. Security: `eng-secreview` on risk flags, always for CRITICAL.
5. Stop gate: a session can't end with source changes newer than its last verification evidence (blocks once).
6. Outcome: `eng-outcome` measures the success signal after release.

## Security model
Defense in depth:
1. **Native boundary first:** project permissions + OS sandbox recommended by `eng-init`. Docs list macOS, Linux, and WSL2; native Windows support is version-dependent, so check with `/sandbox`.
2. **Guard hooks:** destructive, irreversible, and secret-exposing commands route to **you** via a native permission prompt. Catastrophic ones are denied. A quote- and heredoc-aware parser with 240 regression cases.
3. **Secrets guard:** reading or writing secret files and credential literals → ask.
4. **Verifier scans:** tamper and secret checks on every verification.
5. **Least-privilege agents:** explicit tool lists; reviewers and judges are read-only; workers cannot spawn agents.
Hooks are a safety net, not a sandbox.

## Benchmark (the OS is evaluated like software)
`evals/` holds native `claude plugin eval` cases: trivial change, simple bug, medium feature, full-stack feature, security-sensitive feature, parallel work, merge conflict, failed-test recovery, debugging, UI, AI feature with eval, deployment verification, destructive request, secret access, scope creep. Run from the plugin directory:
```
claude plugin eval . --scaffold --trust-plugin --allow-tools Bash Write Edit --ablation none -j 3 --max-cost-usd 15
```

## Extending
Change the OS in its repo, never inside product repos.
- Validate: `node scripts/validate-org.mjs && node scripts/verify-hooks.mjs && node scripts/test-engines.mjs && claude plugin validate .`
- Every generalizable lesson gets a PROC entry and, where possible, an eval case that would have caught it.
