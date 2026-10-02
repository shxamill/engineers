# Changelog

All notable changes to the `engineering-os` plugin. Versions follow [Semantic Versioning](https://semver.org/): a behavior change to gates, hooks, engines, or the registry format bumps at least the minor version, and a change that can block work that passed before bumps the major version. Upgrade notes for 3.0.0 are in [`docs/engineering/v3-migration.md`](../../docs/engineering/v3-migration.md).

## 3.0.0 — 2026-10-02

V3 changes **what counts as proof**, **how classification is checked**, and **how the OS observes itself**. Design: [ADR-0003](../../docs/engineering/adr/0003-engineering-os-v3.md), [architecture](../../docs/engineering/v3-architecture.md); evidence: [audit](../../docs/engineering/v3-audit.md), [research](../../docs/engineering/v3-research.md).

### Breaking (can block work that 2.0.0 allowed)
- **Content-fingerprint freshness.** Verification and reviewer verdicts are bound to a fingerprint of the source tree, not to file mtimes. Touching an evidence file no longer satisfies the gate; any source edit after verification requires re-verification. Committing does not. Evidence and ledger entries without a fingerprint (2.x, or hand-written) never count in a git repository: re-run `eng-verify` and the reviews once after upgrading. (A-01, review R-4)
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
- `scripts/mutation-check.mjs`: 33 scripted mutations of gates, guards, router, plan-check, verifier, release check, and the fresh-review fixes; each must make a test fail (a crash doesn't count). Runs in CI. (A-17)
- `verify-hooks` asserts every hook invocation finishes within 5 s and prints p50 per hook with `--timings`. (A-18)
- Validator: frontmatter key allowlists for agents and skills; registry ↔ agent (tier → model), registry ↔ skill (reviewer skills fork the same agent), budget reviewers must be gate reviewers; total description budget. (A-16, A-24)
- Eval case `16-verification-evasion` (deadline pressure to make a red suite green); process graders marked `arm: with-only`, budget graders `arm: both`, for two-arm benchmarks. (A-31..A-33)
- CI job `robustness`: engine and hook suites under `core.autocrlf=true`, then the mutation check. (A-27)
- Release plan template: service-level (SLI/SLO/rollback trigger) table. (A-36)

### Changed
- Handoff contract: `TASK:` (V2 `OBJECTIVE:` still accepted); output cut off by the turn limit is FAIL or BLOCKED, never PASS. Ledger entries record `agent_id` and the fingerprint. (A-20)
- Constitution: claim labels CONFIRMED / LIKELY / UNKNOWN / BLOCKED; evidence, ledger, and state are engine-written only.
- Skills `eng`, `eng-intake`, `eng-plan`, `eng-build`, `eng-verify`, `eng-release`, `eng-status`, `eng-retro`, `eng-init` updated for the above.

### Fresh-context review fixes (before release)
An independent review of the 3.0.0 change ([record](../../docs/engineering/reviews/v3-fresh-review.md)) found 5 blocking and 15 should-fix defects. All are fixed or recorded below, each with a regression test (PROC-28):
- `eng-verify` diffs committed work on the default branch against the session start, not `HEAD` (R-1); a failing test that mentions ENOENT is FAIL (R-2); `--only`/`--skip` runs are marked `partial` (R-9); the evidence path is always relative (R-15); `node --test` durations, and on Windows escaped paths and `file://` URLs, no longer defeat PRE_EXISTING (R-16; the Windows part was found by CI).
- Fingerprint: the temporary index keeps the real index's mtime, so same-second edits are seen (R-3); non-ASCII paths, `requirements.txt`, and lockfiles are classified correctly (R-11).
- Gate: entries without a fingerprint and future-dated ledger entries never count (R-4); session commits left on another branch block (R-5); a full run at the class's verify level is required (R-9); stale ACs and empty plans don't satisfy the gates (R-10); camelCase paths imply flags (R-12); only lines starting with `Waived:` waive (R-23); MEDIUM work with any risk flag needs adversarial QA (registry `reviewers_if_flagged`, PROC-6 made deterministic).
- Guards: the evidence guard handles quotes, globs, variables, `cd`, write options of read-only tools, string concatenation, and PowerShell variables (R-5, R-6); reading evidence and working on the hook sources is no longer denied (R-8); file-tool paths are normalized and symlinks resolved (R-7); writing `project-profile.json` asks the human (R-17).
- Handoff: a valid handoff re-sent after a block is recorded (R-13); only namespaced plugin agents write the ledger (R-14).
- Router: a risk flag lifts TRIVIAL to SMALL (R-18); `--risk` is case-insensitive (R-23). Release check: "TBD"/"pending" isn't an approval; "errors flat" isn't a failure (R-19).
- Evals: LLM criteria scored in both arms describe outcomes, not OS steps (R-20). Mutation check: a crash no longer counts as a kill (R-22).

### Known limitations
- The guards are heuristics and run as the same OS user as the agent; a deliberately adversarial agent can still forge files by indirect means. CI and human review are the independent verifiers; the OS sandbox (not available on native Windows) narrows what the shell can write.
- The Stop gate blocks once per stop attempt (`stop_hook_active`), so it is a strong nudge rather than a hard stop.
- Reviewer verdicts are recorded per agent, not per capability: one `security-engineer` PASS covers every security review the flags require (review R-14).
- Indirect writes (computed paths, generated scripts) can still evade the evidence and profile guards (review R-6, R-17).
- Hooks are tested in CI on Windows but have not been exercised in a live native-Windows session.

## 2.0.0 — 2026-10-01

Engineering OS packaged as a Claude Code plugin with a marketplace ([ADR-0002](../../docs/engineering/adr/0002-engineering-os-v2.md)): constitution injected by hooks, capability registry and router, deterministic engines (detect, verify, plan-check), F0–F16 lifecycle, Stop gate with a reviewer ledger, and a 15-case native eval benchmark. Later 2.0.0 commits added PROC-7 through PROC-15 (gate ledger, session start HEAD, baseline-aware verification, risk deliverables, class-vs-diff check, Windows CI fix, `worktree.baseRef`) without a version bump; see [decisions](../../docs/engineering/decisions.md).

## 1.x — 2026-10-01 (unversioned)

The original organization as project files under `.claude/` ([ADR-0001](../../docs/engineering/adr/0001-engineering-organization.md)), validated in the bootstrap retrospective.
