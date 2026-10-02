# Engineering Status

## Now
- Objective: Engineering OS V3: audit, research, architecture, and implementation (evidence model, classification checks, task DoR/DoD, release check, telemetry, mutation checks, two-arm benchmark)
- Class: LARGE · Risk: high · Flags: infra, secrets (CI workflow and the secrets guard change)
- Skipped: plan_complete (V3 work is tracked as audit findings A-01..A-36 and PROC-16..27 rather than a task table)
- AC-1: Verification and reviewer verdicts are fresh only at the current source-content fingerprint (verify-hooks `stop v3` cases; mutation `gate-fingerprint`)
- AC-2: Shell and file-tool writes to evidence, ledger, state, and telemetry are denied; reads are allowed (verify-hooks deny/allow cases)
- AC-3: Changed paths and new dependencies imply risk flags that must be declared or waived; SMALL+ needs acceptance criteria; MEDIUM+ needs a finished plan (verify-hooks `stop v3` cases)
- AC-4: Every safety mutation in `mutation-check.mjs` is killed by a failing test (33/33), and the suites pass under `core.autocrlf=true`
- AC-5: A two-arm, three-run benchmark is reported per arm without aggregation or projection (ADR-0004)
- Phase: F11 verification and fresh-context review of the V3 change
- Current task: none
- Next actions: run the two-arm benchmark (ADR-0004); confirm org-ci on Ubuntu, Windows, and the robustness job; owner validates on a real product repository and a live Windows session
- Blockers: none

## Phases
V3: F0 ✓ inspect + baseline (E-1..E-4) · F1 ✓ research ([v3-research](v3-research.md)) · F0 ✓ audit ([v3-audit](v3-audit.md)) · F4 ✓ architecture ([v3-architecture](v3-architecture.md), ADR-0003/0004) · F7–F8 ✓ build · F11 … verify + fresh-context review · benchmark …

## Checks
`node plugins/engineering-os/scripts/validate-org.mjs` · `verify-hooks.mjs` (365) · `test-engines.mjs` (104) · `mutation-check.mjs` (33/33 killed) · `claude plugin validate plugins/engineering-os --strict` · suites also pass with `core.autocrlf=true`. org-ci on GitHub: confirm after push (PROC-14).

Reviews: this repository's own gate ledger has no reviewer entries for V3. The V3 change was reviewed by an independent fresh-context agent (not the plugin's reviewer agents): 5 BLOCKING and 15 SHOULD_FIX findings, all fixed or documented with regression tests ([record](reviews/v3-fresh-review.md), PROC-28).

## Planned
- Two-arm benchmark, three runs per case ([ADR-0004](adr/0004-evaluation-model.md)).
- First tagged release (`v3.0.0`) once CI and the benchmark are reported.
- License decision (human gate: legal).
- Exploratory: deterministic checks for risk-flag deliverables (still instruction-only).

## Risks
- Guards are heuristics running as the same OS user as the agent; evidence protection stops direct writes, not a determined adversary. CI and human review remain the independent checks; the sandbox narrows shell writes (not on native Windows).
- `risk_paths` patterns can miss unusually named files and can flag harmless ones (which then need a recorded waiver).
- Hooks are verified in CI on Windows, not in a live Windows session. The sandbox is unsupported on native Windows (use WSL2).
- Benchmark fixtures are small and the graders are written by this project.

## Assumptions
- [ASSUMPTION] Node 18+ is on PATH wherever the plugin runs (hooks and engines need it).
- [ASSUMPTION] Product repos install the plugin from this marketplace; no OS files are copied into them.

## Completed (last 10)
- V3 research (CC/AG/ORG/SEC, experiments E-1..E-4), audit (A-01..A-36), architecture, ADR-0003/0004, migration guide, CHANGELOG, version 3.0.0
- Content fingerprint freshness; protected evidence; ledger with agent_id + fingerprint (PROC-16, PROC-17)
- Registry v2 (tiers, risk_dimensions, gates, risk_paths, reviewer_gate); validator cross-checks (PROC-18)
- Router: dimensions, mandatory-first staffing, uncovered report (PROC-19)
- Stop gate: path-implied flags, AC and plan gates (PROC-20); plan DoR/DoD and retry budget (PROC-21)
- eng-verify schema 2, CI-bypass and supply-chain detectors (PROC-22); eng-release-check (PROC-23)
- Telemetry + eng-status.mjs (PROC-24); mutation check + autocrlf CI job (PROC-25); handoff TASK and partial-result rule (PROC-26)
- Eval case 16 (verification evasion); arm markings for two-arm benchmarks
- Documentation rebuild (V2): README, plugin manual, CONTRIBUTING, records index; PROC-14, PROC-15
- V2: plugin + marketplace, registry + router, engines, 16 agents, 24 skills, Stop gate, 15-case benchmark (runs 1–2)
