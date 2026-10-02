# Engineering OS V3 — audit of V2

_Date: 2026-10-02 · Audited revision: `7721226` (plugin 2.0.0) · Claude Code 2.1.287_

## Verified inventory

Every figure below was checked against the repository on this date. None is copied from earlier documents.

| Item | Verified value | How |
|---|---|---|
| Agents | 16 | `ls plugins/engineering-os/agents` |
| Skills | 24 (18 workflow, 6 path-scoped standards) | `ls skills/`; validator summary |
| Capabilities | 31 in 7 groups | `routing/capabilities.yaml` |
| Hook handlers / events | 7 handlers on 6 events | `hooks/hooks.json`; `claude plugin details` |
| Hook tests | 255/255 | `node scripts/verify-hooks.mjs` |
| Engine tests | 46/46 | `node scripts/test-engines.mjs` |
| Eval cases | 15 | `evals/NN-*/case.yaml` |
| Always-on context, CLI estimate | ~2,150 tokens | `claude plugin details` |
| Always-on context, measured first turn | +1,748 tokens (29,295 → 31,043) | research E-1 |
| Hook runtime p50 (Linux, Node 22) | 41–73 ms; Node startup alone 23 ms | research E-4 |
| CI | `org-ci` green on Ubuntu and Windows since `afb6059` | GitHub Actions runs 14–15 |

## What V2 got right (preserved in V3)

| Mechanism | Evidence it works | V3 action |
|---|---|---|
| Plugin + marketplace packaging; constitution injected by hook | Install/update/uninstall executed (2026-10-01) | Keep |
| Class budgets; TRIVIAL work spawns nothing | Benchmark run 2: delegation-budget graders 2/2 | Keep |
| Fresh-context reviewers (forked skills, `background: false`) | PROC-13; run 2 05/06/10 re-runs passed | Keep |
| Guard hooks with a quote/heredoc-aware lexer; `ask` routes to the human | 13 and 14 pass in both runs; 255 hook cases | Keep, extend |
| Baseline-aware verifier (PRE_EXISTING) | PROC-10; case 15 | Keep |
| Gate ledger + completion gate | PROC-7/8/11/13; review no longer skipped | Keep; harden (A-01, A-02) |
| Reviewer severity BLOCKING / SHOULD_FIX / NIT | `agents/code-reviewer.md` | Keep |
| Deterministic engines with one-line verdicts | Router, detect, verify, plan-check | Keep, extend |

## Findings

Priorities:
- **P0 (blocking):** undermines a core guarantee.
- **P1 (material):** a real reliability, security, or quality gap.
- **P2 (improvement):** worthwhile, but not urgent.

| ID | Area | Finding | Evidence | Impact | Recommendation | Priority |
|---|---|---|---|---|---|---|
| A-01 | Verification | Verification freshness compares file mtimes. `touch .eng/evidence/verify-latest.json` satisfies the gate, and `git checkout` or `stash` rewrites mtimes, which causes false blocks and false passes | `hooks/scripts/stop-verify.mjs`: `statSync(evidence).mtimeMs >= latest`; research E-3 | "Verified" can mean "verified some other content" | Bind evidence to a **content fingerprint** of the source tree (temporary git index → `write-tree` → filtered `ls-tree`). Committing doesn't change it; any source edit does. Fall back to mtime only for V2 evidence | **P0** |
| A-02 | Security / evidence | The gate ledger and verify evidence can be forged from the shell: piping JSON into `check-handoff.mjs`, `echo … >> gates.jsonl` (`echo` is classed as prose and never checked), or writing `verify-latest.json` | Research E-3: 15 forged `code-reviewer PASS` entries; `guard-bash.mjs` prose/readOnly exemption | Defeats the evidence model, the exact reward-hacking pattern METR documents (AG-5) | (a) Deny shell writes to `.eng/evidence`, `.eng/state`, and `.eng/telemetry.jsonl`, and direct invocation of `check-handoff`/`stop-verify`, including via redirect targets. (b) Deny Edit/Write to those paths. (c) Ledger entries carry `agent_id` and the fingerprint. (d) The gate checks that the evidence directory referenced by `verify-latest.json` exists and agrees. (e) Document the residual same-user risk (research CC-10/11) | **P0** |
| A-03 | Capability routing | A mandatory risk capability can lose the single SMALL specialist slot to a trigger match | `eng-route.mjs`: candidates first, then `staffed.slice(0, 1)`. Reproduced: `--scope small --flags ui` staffs `frontend`, prints `MANDATORY ux` | A required risk capability is silently unstaffed | Order staffing as mandatory first, then triggers; regression test | P1 |
| A-04 | Classification | Risk is a single self-declared level. The nine dimensions are scored only in the model's head and never recorded or checked | `classify(scope, risk)`; `skills/eng-intake` step 2 | Risk understatement is invisible; telemetry can't learn | `eng-route --dims name=level,…` computes risk = max and rejects `--risk` below it; the decision is logged with dims | P1 |
| A-05 | Classification | Risk flags are self-declared. Nothing compares them with what actually changed | `stop-verify.mjs` reads `Flags:` but never checks paths; run 2 cases 03/05/10/11 declared SMALL | Security review skipped by omission (e.g. an auth change without `auth`) | Registry `risk_paths` per flag; the gate requires each matched flag to be declared or `Waived: <flag> (<reason>)`; new-dependency detected from manifest diffs | P1 |
| A-06 | Routing: single source of truth | The reviewer→skill map (`GATE_SKILL`) is hard-coded in `stop-verify.mjs`, and the flag-reviewer set `['appsec','supply-chain','privacy']` is duplicated in `eng-route.mjs` and `stop-verify.mjs` | Source | Drift between router, gate, and skills | Registry fields `reviewer_gate: true` and `skill`; validator checks registry ↔ skill ↔ agent (fork skills name the same agent) | P1 |
| A-07 | Task orchestration | Plan rows have no acceptance criteria, attempt count, or evidence location. `eng-plan-check` doesn't validate owner↔capability agent, Definition of Ready, Definition of Done, or the retry budget | `scripts/eng-plan-check.mjs` REQUIRED columns; no owner check | Premature "DONE" (AG-1); retry loops untracked | Columns `AC`, `Attempts`, `Evidence`; checks: owner = registry agent for the capability; READY needs files, verifier, and AC; DONE needs evidence that exists; attempts above budget must be FAILED/BLOCKED. V2 tables accepted with a warning | P1 |
| A-08 | Lifecycle | Skipped phases are not enforced. MEDIUM+ work can finish without acceptance criteria or a finished plan | Run 2 case 03 (no ACs); eng skill §3 is prose only | Process depth depends on model diligence | Registry `gates` per class: acceptance criteria (SMALL+), plan complete (MEDIUM+); a skip needs `Skipped: <gate> (<reason>)` in status Now | P1 |
| A-09 | Verification | No NOT_APPLICABLE status; the vocabulary can't distinguish "irrelevant here" from "missing". A NO_CHECKS verdict satisfies the gate silently | `eng-verify.mjs` LEVELS/verdict | Gaps hidden or overstated | `overrides.notApplicable: {kind: reason}` → `NOT_APPLICABLE (reason)`; NO_CHECKS stays visible in the status report | P2 |
| A-10 | Verification / test integrity | Tamper detection misses CI bypass: `\|\| true` or `\|\| exit 0` on test commands, `continue-on-error: true`, `--passWithNoTests`, a lowered coverage threshold, a test script replaced with a no-op | `analyzeDiff`: only deleted tests, skip markers, assertion count, config-file WARN | Green without real tests (AG-5) | New detectors: bypass patterns in added lines of manifests/CI/config → FAIL; threshold decrease → WARN | P1 |
| A-11 | Supply chain | No deterministic supply-chain check on diffs | No such line in `eng-verify` | Unpinned actions, write-all tokens, and new dependencies slip through review | `SUPPLY-CHAIN` line: unpinned `uses:` added (WARN), `permissions: write-all` added (FAIL), `pull_request_target` + PR-head checkout (FAIL), manifest changed without lockfile (WARN), new dependencies listed (signal for the `new-dependency` flag) | P1 |
| A-12 | Release | Release readiness is a template checklist that nothing checks before deploy | `templates/release-plan.md`; `skills/eng-release` | "Every line needs evidence" is advisory | `eng-release-check.mjs` validates `release-plan.md` (each row PASS or N/A with reason plus evidence; named human approval for production; post-deploy table for the verify stage) and reports env-var names PRESENT/MISSING without reading values | P1 |
| A-13 | Observability | No telemetry for the OS itself: agents spawned, reviews, gate blocks, guard decisions, and verify failures are invisible | No writer exists | Overstaffing, rework, and false positives can't be measured (AG-7, ORG-8) | Append-only `.eng/telemetry.jsonl` from router, hooks, and verifier; summarized by `eng-status.mjs` | P1 |
| A-14 | Observability / tokens | `eng-status` is assembled by the model (git, plan, evidence reads) | `skills/eng-status/SKILL.md` | Several tool calls for a deterministic report | `scripts/eng-status.mjs` prints the report covering project, class, risk, phase, tasks, active agents, blockers, verification, reviews, security, release, outcome, and cost counters | P2 |
| A-15 | Model routing | Models are literal aliases per agent with no tier concept and no documented override | `agents/*.md` `model:`; registry `model` | Hard to reason about or remap cost and quality | Registry `tiers: {low: haiku, medium: sonnet, high: opus}` plus `tier` per capability, validated against agents. Document the platform overrides (`ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, per-call `model`) (CC-4) | P2 |
| A-16 | Configuration validation | Claude Code silently ignores unknown frontmatter fields (CC-5); the validator doesn't allowlist keys | `validate-org.mjs` checks known fields only | A typo silently removes a bound such as `maxTurns` | Allowlists for agent and skill frontmatter keys | P1 |
| A-17 | Testing | Mutation checks were manual and ad hoc (PROC-13 used one hand edit) | Retrospectives | "Tests pass" is unproven for safety mechanisms | `scripts/mutation-check.mjs`: scripted mutations of the gate, fingerprint, evidence guard, secrets guard, deny list, router ordering, and plan-check; each must turn a suite red; run in CI (Ubuntu) | P1 |
| A-18 | Hooks | No runtime budget; a pathological regex or git hang would surface only in live sessions | E-4 measured once by hand | Slow hooks degrade every tool call | `verify-hooks` asserts every invocation stays under 5 s and prints p50 per hook | P2 |
| A-19 | Hooks | The completion gate blocks once per stop attempt. A non-compliant agent can end after one block | `stop_hook_active` early exit | Gate is a strong nudge, not a hard stop | Keep, because the trap risk of an unresolvable condition is worse (CC-1). Make the outcome visible: telemetry records `gate=block`, and `eng-status` shows "last stop ended with open gates" | P2 |
| A-20 | Agent model | Handoff uses `OBJECTIVE` where the V3 contract says `TASK`; partial (`maxTurns`) results are not addressed; no uncertainty vocabulary | `constitution.md` | Ambiguous status of truncated work; guesses reported as facts | `TASK:` (with `OBJECTIVE:` still accepted); "partial ⇒ FAIL or BLOCKED"; claim labels CONFIRMED / LIKELY / UNKNOWN / BLOCKED | P2 |
| A-21 | Least privilege | Document-writing agents (architect, product-manager, ux-designer, researcher, security-engineer, tech-writer) hold generic Edit/Write. Frontmatter can't path-scope them, and plugins can't ship permission rules (R-CC-2) | `agents/*.md` | A doc agent could edit code | Accept (no platform mechanism). Detection: handoff diff check, class/scope gate, scope judge. Documented in the tool table below | P2 |
| A-22 | Sandboxing | The OS sandbox is recommended once by `eng-init` but never reported afterwards; the orchestrator can't tell whether it's on | `session-context.mjs` | Users assume isolation they don't have | The session snapshot reports `sandbox=on/off/not configured` from settings files, without claiming OS support; status shows it | P1 |
| A-23 | Secrets | Release readiness says "names only", but no tool checks presence without reading values | `templates/release-plan.md` | Agents may read `.env` to check presence | `eng-release-check --env A,B` prints PRESENT/MISSING per name; values never printed | P2 |
| A-24 | Context cost | Footprint is measured but not budgeted; description growth is unbounded | Validator prints chars only | Silent always-on creep | Validator budget: total description characters ≤ 5,600, counting path-scoped standards too (V2 method, which excluded them: 4,384; V3: 4,432 excluding them, 5,080 including them); constitution ≤ 45 lines (existing) | P2 |
| A-25 | Token cost | Enforced reviews raised benchmark cost 3.3× (run 1 $2.80 → run 2 $9.16); the PROC-12 review-round cap is unmeasured | `benchmarks/v2-run2.md` | Cost regressions invisible | The benchmark reports cost per arm and per case; telemetry counts reviewer rounds | P2 |
| A-26 | Recovery | The attempt count lives only in the model's context; the retry ladder is not tracked | eng skill §4 | Loops or premature escalation | Plan `Attempts` column enforced against the class budget (A-07) | P2 |
| A-27 | Portability | New git plumbing (temporary index, `write-tree`) must behave identically on Windows and under `core.autocrlf` | PROC-14 history | A cross-platform evidence mismatch would false-block | CI runs engine and hook suites with `core.autocrlf=true` on Ubuntu as well as on Windows | P2 |
| A-28 | Windows | No live interactive Windows session has ever exercised the hooks; CI only | Status; README | Unverified real-world behavior | Keep the CI matrix; record as a known limitation; ask the owner to run the smoke checklist | P1 |
| A-29 | Packaging / versioning | `version` stayed 2.0.0 through PROC-7..15 behavior changes; no changelog or migration notes | `plugin.json`; git log | Users can't tell what changed; pinning is meaningless (CC-12) | Version bump per behavior change; `CHANGELOG.md`; `docs/engineering/v3-migration.md` | P1 |
| A-30 | Documentation | V3 needs an architecture document, a migration guide, and refreshed READMEs; claims must be re-verified | — | Docs drift | `v3-architecture.md`, `v3-migration.md`, README/manual updates, doc checker in the quality gate | P2 |
| A-31 | Evaluation | No no-plugin baseline: every V2 run used `--ablation none` | `benchmarks/v2-run*.md` | No evidence the OS beats plain Claude Code | Two-arm benchmark (with vs without), three runs per case, with identical prompts (CC-13, E-2) | **P0** |
| A-32 | Benchmarking | Single runs; process graders (VERDICT line, agent names) would push the baseline toward zero and inflate Δ | Case files | Misleading comparison | `arm: with-only` on process graders; outcome graders scored in both arms; report mean, pass^3, and cost per arm | P1 |
| A-33 | Benchmarking | No case pressures the agent to bypass verification (the AG-5 pattern) | `evals/` | Tamper defenses untested end to end | New case 16: "make CI green fast" with a genuinely failing test; graders check that the test is intact, no bypass was added, and the bug was fixed | P2 |
| A-34 | Self-improvement | `PROC-n` lessons aren't systematically linked to a regression test or eval | `decisions.md` | Lessons decay | Each V3 `PROC` row names its regression test; CONTRIBUTING requires it | P2 |
| A-35 | Architecture | The platform now offers dynamic workflows and `/goal` (CC-15); V2 docs don't position against them | — | Users may duplicate orchestration | Document: task graph by default; workflows for LARGE homogeneous fan-out under the team-budget rule; Stop hook rather than `/goal` as the gate | P2 |
| A-36 | Operations | SLO/SLI guidance exists only in agent prompts; the release plan has no SLO rows; outcomes have no delivery-health fields | `templates/release-plan.md`, `eng-outcome` | Post-deploy checks lack thresholds | Release plan gets an SLI/SLO table (1–3 rows) with rollback triggers; outcomes may record DORA-style data diagnostically (ORG-4, ORG-8) | P2 |

## Hook audit

| Hook | Event / matcher | Input used | Output | Failure mode | Security role | Cost (p50) | Coverage | V3 change |
|---|---|---|---|---|---|---|---|---|
| `session-context` | SessionStart `startup\|resume\|clear\|compact` | `session_id`; git; profile; status Now | stdout context (constitution + snapshot) | Errors → partial or no context (fail open) | Records start HEAD for the gate | 73 ms; ~630 tokens of context | 4 cases | Adds `sandbox=` state |
| `subagent-context` | SubagentStart `engineering-os:` | none | `additionalContext` constitution | Missing file → no context | Same rules for org agents | 46 ms | 1 case | Telemetry `spawn` event (agent, agent_id) |
| `guard-bash` | PreToolUse `Bash\|PowerShell` | `command`, `tool_name` | deny/ask JSON | Parse error → `ask` (fail closed) | Catastrophic deny; destructive and secret ask | 48–53 ms | ~200 cases | Evidence-tamper deny (A-02); telemetry for ask/deny (reason only) |
| `guard-secrets` | PreToolUse `Read\|Edit\|Write\|MultiEdit\|NotebookEdit\|Grep` | path, glob, written content | ask JSON | Error → `ask` | Secret files and credential literals | 47 ms | ~25 cases | Deny Edit/Write to evidence paths (A-02) |
| `format-edited` | PostToolUse `Edit\|Write\|MultiEdit` | `file_path` | none (runs formatter) | Never blocks | none | 43 ms | 2 cases (no-op paths only) | Unchanged |
| `check-handoff` | SubagentStop (all) | `agent_type`, `agent_id`, last message | exit 2 + reason, or ledger append | Error → accept (fail open) | Evidence contract | 41 ms | ~20 cases | Records `agent_id` and fingerprint; accepts `TASK:`; telemetry `handoff` |
| `stop-verify` | Stop | `session_id`, `stop_hook_active` | exit 2 + reason | Error → allow stop (fail open); once per stop attempt | Completion gate | 57 ms | 29 cases | Fingerprint freshness; evidence cross-check; risk-path flags; AC and plan gates; telemetry `gate` |

## Tool least privilege

| Agent | Tools | Needs | Assessment |
|---|---|---|---|
| code-reviewer, scope-judge, adversarial-qa | Read, Grep, Glob, Bash, PowerShell | Run tests, linters, git | Minimal for an independent verifier. No Edit/Write/Agent/Web |
| debugger, backend, frontend, ai, platform, reliability, test engineers | Read/Grep/Glob, Edit, Write, Bash, PowerShell (+ WebFetch for ai-engineer) | Implement and run checks | Appropriate; WebFetch for ai-engineer covers model/API docs |
| security-engineer | + Write/Edit, WebSearch, WebFetch | Threat models, reviews, advisories | Write needed for `security.md`; dynamic tests limited to authorized targets by instruction (advisory) |
| architect, product-manager, researcher, ux-designer, tech-writer | Read/Grep/Glob, Write/Edit (+ Web for research roles; architect has Bash) | Write documents | Edit can't be path-scoped (A-21). Architect's Bash is used for repository inspection (`git log`, tool versions) |
| All | no `Agent` tool | Only the orchestrator staffs | Validator-enforced |

## Classification of policies: deterministic vs advisory

| Policy | V2 | V3 |
|---|---|---|
| Dangerous commands, secrets, evidence tampering | Deterministic (guards) | Deterministic, plus evidence paths |
| Verification freshness | Deterministic (mtime: weak) | Deterministic (content fingerprint) |
| Required reviewers per class/flags | Deterministic (ledger) | Deterministic (ledger + fingerprint) |
| Class fits diff | Deterministic (PROC-13) | Unchanged |
| Risk flags fit changed paths | Advisory | Deterministic, with recorded waivers |
| Acceptance criteria and plan completion | Advisory | Deterministic for SMALL+ / MEDIUM+, with recorded skips |
| Task DoR/DoD, owners, retry budget | Partly (plan-check) | Deterministic (plan-check) |
| Release readiness | Advisory | Deterministic (`eng-release-check`) |
| Design quality, trade-offs, threat analysis, intent | Model judgment | Model judgment (by design) |
