# Changelog

All notable changes to the `engineering-os` plugin. Versions follow [Semantic Versioning](https://semver.org/): a behavior change to gates, hooks, engines, or the registry format bumps at least the minor version, and a change that can block work that passed before bumps the major version. Upgrade notes for 3.0.0 are in [`docs/engineering/v3-migration.md`](../../docs/engineering/v3-migration.md).

## 3.0.0 — 2026-10-02

V3 changes **what counts as proof**, **how classification is checked**, and **how the OS observes itself**. Design: [ADR-0003](../../docs/engineering/adr/0003-engineering-os-v3.md), [architecture](../../docs/engineering/v3-architecture.md); evidence: [audit](../../docs/engineering/v3-audit.md), [research](../../docs/engineering/v3-research.md).

### Breaking (can block work that 2.0.0 allowed)
- **Content-fingerprint freshness.** Verification and reviewer verdicts are bound to a fingerprint of the source tree, not to file mtimes. Touching an evidence file no longer satisfies the gate; any source edit after verification requires re-verification. Committing does not. V2 evidence without a fingerprint falls back to the old mtime rule. (A-01)
- **Protected evidence.** The guards deny shell and Edit/Write access that writes `.eng/state/`, `.eng/telemetry.jsonl`, `.eng/evidence/verify-*`, `verify-latest.json`, or `gates.jsonl`, and deny running `check-handoff.mjs` or `stop-verify.mjs` directly. Scratch logs elsewhere under `.eng/evidence/` stay writable. (A-02)
- **Risk flags are checked against the diff.** Changed paths that match a registry `risk_paths` pattern, and new dependencies, imply a flag that status.md `Flags:` must declare or waive with `Waived: <flag> (<reason>)`. TRIVIAL work cannot carry a risk flag. (A-05)
- **Lifecycle gates.** SMALL+ work needs acceptance criteria (`AC-n: …`) in status.md; MEDIUM+ work needs a complete implementation plan (no task READY/RUNNING/REVIEW/VERIFICATION). A deliberate skip is `Skipped: <gate> (<reason>)`. (A-08)
- **Registry format v2.** Capabilities use `tier: low|medium|high` instead of `model:`; new top-level `tiers`, `risk_dimensions`, `gates`, `risk_paths`; reviewer capabilities carry `reviewer_gate: true` and `skill:`. (A-06, A-15)
- **Plan table columns.** `AC`, `Attempts`, and `Evidence` columns are checked (DoR: AC ids; DoD: evidence path exists; attempts within the class retry budget). V2 tables still parse, with a warning. (A-07, A-26)

### Added
- `scripts/eng-status.mjs`: deterministic status report and `--metrics` over telemetry. `/eng-status` runs it. (A-14)
- `scripts/eng-release-check.mjs`: release readiness (`READY`/`NOT_READY`), named human approval for production, post-deploy actuals, and `--env NAME,…` presence checks that print PRESENT/MISSING only. (A-12, A-23)
- `.eng/telemetry.jsonl`: append-only local events (`route`, `spawn`, `handoff`, `verify`, `guard`, `gate`); guard events record reason categories, never command text. (A-13)
- `hooks/scripts/gates.mjs`: the completion-gate logic, shared by the Stop hook and `eng-status`.
- `eng-route --dims name=level,…`: risk is the highest dimension; an understated `--risk` is rejected; mandatory capabilities are staffed before trigger matches, and those the budget can't cover are printed as `UNCOVERED BY BUDGET`. (A-03, A-04)
- `eng-verify`: `NOT_APPLICABLE (reason)` from `overrides.notApplicable`; CI-bypass tamper detection (`|| true`, `|| exit 0`, `--passWithNoTests`, `continue-on-error: true`, no-op test script, lowered coverage threshold); a `SUPPLY-CHAIN` line (unpinned actions, `permissions: write-all`, `pull_request_target` with a PR-head checkout, manifest without lockfile, new dependencies); a schema-2 `summary.json` with per-check status, fingerprint, and commit; `--task`. (A-09, A-10, A-11)
- Session snapshot reports the sandbox setting (`on`/`off`/`not configured`) from settings files. (A-22)
- `scripts/mutation-check.mjs`: 22 scripted mutations of gates, guards, router, plan-check, verifier, and release check; each must turn a suite red. Runs in CI. (A-17)
- `verify-hooks` asserts every hook invocation finishes within 5 s and prints p50 per hook with `--timings`. (A-18)
- Validator: frontmatter key allowlists for agents and skills; registry ↔ agent (tier → model), registry ↔ skill (reviewer skills fork the same agent), budget reviewers must be gate reviewers; total description budget. (A-16, A-24)
- Eval case `16-verification-evasion` (deadline pressure to make a red suite green); process graders marked `arm: with-only`, budget graders `arm: both`, for two-arm benchmarks. (A-31..A-33)
- CI job `robustness`: engine and hook suites under `core.autocrlf=true`, then the mutation check. (A-27)
- Release plan template: service-level (SLI/SLO/rollback trigger) table. (A-36)

### Changed
- Handoff contract: `TASK:` (V2 `OBJECTIVE:` still accepted); output cut off by the turn limit is FAIL or BLOCKED, never PASS. Ledger entries record `agent_id` and the fingerprint. (A-20)
- Constitution: claim labels CONFIRMED / LIKELY / UNKNOWN / BLOCKED; evidence, ledger, and state are engine-written only.
- Skills `eng`, `eng-intake`, `eng-plan`, `eng-build`, `eng-verify`, `eng-release`, `eng-status`, `eng-retro`, `eng-init` updated for the above.

### Known limitations
- The guards are heuristics and run as the same OS user as the agent; a deliberately adversarial agent can still forge files by indirect means. CI and human review are the independent verifiers; the OS sandbox (not available on native Windows) narrows what the shell can write.
- The Stop gate blocks once per stop attempt (`stop_hook_active`), so it is a strong nudge rather than a hard stop.
- Hooks are tested in CI on Windows but have not been exercised in a live native-Windows session.

## 2.0.0 — 2026-10-01

Engineering OS packaged as a Claude Code plugin with a marketplace ([ADR-0002](../../docs/engineering/adr/0002-engineering-os-v2.md)): constitution injected by hooks, capability registry and router, deterministic engines (detect, verify, plan-check), F0–F16 lifecycle, Stop gate with a reviewer ledger, and a 15-case native eval benchmark. Later 2.0.0 commits added PROC-7 through PROC-15 (gate ledger, session start HEAD, baseline-aware verification, risk deliverables, class-vs-diff check, Windows CI fix, `worktree.baseRef`) without a version bump; see [decisions](../../docs/engineering/decisions.md).

## 1.x — 2026-10-01 (unversioned)

The original organization as project files under `.claude/` ([ADR-0001](../../docs/engineering/adr/0001-engineering-organization.md)), validated in the bootstrap retrospective.
