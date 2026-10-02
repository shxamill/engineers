# V3 fresh-context review

_Date: 2026-10-02 · Reviewed: the V3 working tree on top of `7721226` (pushed as `de51fee`) · Reviewer: an independent agent that saw only the diff, the design documents, and a list of claims to check, not the design conversation · Fixes: the commit after `de51fee`_

The V3 brief required a review from a context that did not design the change. The reviewer reproduced each finding in scratch repositories unless it marked the finding UNVERIFIED. Every finding below was re-checked here, first as a failing test, and then fixed or recorded as a limitation.

**Result:** 5 BLOCKING and 15 SHOULD_FIX findings, plus doc, test, and minor findings.
- 18 are fixed, each with a regression test, and most also with a mutation in `mutation-check.mjs`.
- 2 are partly fixed, with the remainder recorded as known limitations.

## Findings and dispositions

| ID | Severity | Finding | Disposition | Regression guard |
|---|---|---|---|---|
| R-1 | BLOCKING | On a default branch with no upstream, `eng-verify` diffed against `HEAD`. Committed work skipped the tamper, secret, and supply-chain scans, and a committed failure was labelled PRE_EXISTING | **Fixed.** The base is now the HEAD the newest session started from (if it is an ancestor of HEAD), before falling back to `HEAD` | engine test `verify fix R-1`; mutation `verify-session-base` |
| R-2 | BLOCKING | A failing test whose output mentioned `ENOENT` was classed NOT_RUN | **Fixed.** NOT_RUN only for a missing tool: spawn ENOENT, exit 127, "command not found", npm `code ENOENT` | engine test `verify fix R-2` |
| R-3 | BLOCKING | The temporary index got a fresh mtime. That disabled git's racy-entry check, so a same-size edit made in the second the index was written was hashed as the old content | **Fixed.** The temporary index keeps the real index's mtime | engine test `fingerprint fix R-3` (deterministic, via `utimes`); mutation `fingerprint-racy` |
| R-4 | BLOCKING | Evidence or ledger entries without a fingerprint fell back to the time rule. A forged `{"status":"PASS","at":<far future>}` line therefore outranked real verdicts indefinitely | **Fixed.** In a git repository, only entries at the current fingerprint count. Ledger entries dated more than 60 s in the future are ignored. 2.x evidence is now stale (migration guide) | hook tests `stop fix R-4` (two); mutations `gate-unfingerprinted`, `gate-future-ledger` |
| R-5 | BLOCKING | Committed work was found only through `.eng/state` and HEAD. Work committed on another branch and left there (or a forged state file) escaped the gate | **Fixed.** The gate now sees commits made this session on other local branches and requires finishing them there. The guards now follow `cd` within a command (the state-file forgery) | hook test `stop fix R-5`; bash deny `cd .eng && echo … > state/…`; mutations `gate-session-branches`, `guard-evidence-cwd` |
| R-6 | SHOULD_FIX | The evidence guard missed simple forms: concatenated quotes, globs, variables, `sort -o`, `uniq IN OUT`, sed `w`, `find -fprint`, `git diff --output`, `xxd -r`, awk redirection, string concatenation in python/node, PowerShell `$p="…"+"…"` | **Fixed for every listed form.** The guard expands simple variable assignments, follows `cd`, matches globs, knows write options of read-only tools, and checks interpreter code with concatenation removed. **Limitation:** it is still a heuristic. Computed paths (for example from `$(…)` or files) and other indirect writes can evade it | 22 new bash/PowerShell deny cases; mutation `guard-evidence-vars` |
| R-7 | SHOULD_FIX | `guard-secrets` matched unnormalized paths (`./`, `//`, `..`, symlink aliases) | **Fixed.** Paths are normalized and the existing prefix is resolved with `realpath` | secrets tests (four, including a symlink alias); mutation `guard-paths-canonical` |
| R-8 | SHOULD_FIX | False positives were hard denials: reading evidence with python/node, `cd` into evidence, and `git add`, `cp`, `prettier`, or `node --check` on the hook sources | **Fixed.** Interpreter code is denied only when it names a protected path *and* writes. The hooks are denied only when executed. `cd` is navigation | 10 new bash allow cases (copying evidence out is a read: copy-like commands are checked only at their destination) |
| R-9 | SHOULD_FIX | Any `eng-verify` run satisfied the gate, including `--only`, `--skip`, and a lower level | **Fixed.** The summary records `partial`, and the gate requires a full run at the class's verify level. `--skip` is reported as skipped | engine test `verify fix R-9`; hook tests `stop fix R-9` (two); mutation `gate-verify-level` |
| R-10 | SHOULD_FIX | Stale or empty artifacts satisfied the gates: ACs from an earlier objective, or a plan with only a header row | **Fixed.** ACs count from status.md Now, or from requirements.md when it changed this session or Now points to it. A plan needs at least one task | hook tests `stop fix R-10` (three) |
| R-11 | SHOULD_FIX | NON_SOURCE was too broad (`requirements.txt`, `*.lock`, any `docs/` segment) and inconsistent for non-ASCII paths | **Fixed.** Only the top-level `docs/`, `.eng/`, `.claude/` and prose/image files are non-source; `ls-tree -z` and `status -z` are used. Lockfiles are source, but don't count toward the class file ceiling | hook test `stop fix R-11`; engine test `fingerprint fix R-11` |
| R-12 | SHOULD_FIX | `risk_paths` missed camelCase names (`AuthService.ts`, `useAuth`) | **Fixed.** Paths are also matched with camelCase boundaries split | hook test `stop fix R-12` |
| R-13 | SHOULD_FIX | After one block, a re-sent valid handoff was never recorded, which forced another review round | **Fixed.** With `stop_hook_active`, a valid handoff is recorded and an invalid one is neither blocked again nor recorded | hook tests `handoff fix R-13` (two) |
| R-14 | SHOULD_FIX | The ledger is keyed by agent name. A bare (non-plugin) `code-reviewer` counted, and any security-engineer PASS satisfies the appsec, privacy, and supply-chain reviews | **Partly fixed.** Only namespaced `engineering-os:` agents write the ledger. **Limitation:** verdicts are still per agent, not per capability, so one security-engineer PASS at the current content covers every security review the flags require | hook test `handoff fix R-14`; mutation `handoff-namespaced` |
| R-15 | SHOULD_FIX | The evidence path was made relative with string replacement, so a trailing slash stored an absolute path and the gate reported "inconsistent" on every run | **Fixed** with `path.relative` | engine test `verify fix R-15` |
| R-16 | SHOULD_FIX | `node --test` `duration_ms` lines defeated PRE_EXISTING detection | **Fixed.** Durations are normalized | engine test `verify fix R-16` |
| R-17 | SHOULD_FIX | `"stopGate": false` (and the check definitions) in `project-profile.json` could be written by the agent | **Partly fixed.** Writing the profile, through the file tools or the shell, now asks the human. **Limitation:** indirect writes (generated scripts) can still change it, as with R-6 | secrets test `edit the project profile`; bash ask case |
| R-18 | SHOULD_FIX | `--scope trivial --flags auth` routed as TRIVIAL, which the gate then blocked | **Fixed.** A risk flag lifts TRIVIAL to SMALL | engine test `route fix R-18`; mutation `route-trivial-flags` |
| R-19 | SHOULD_FIX | Release check: "TBD", "pending", or "none" passed as a production approval, and "0.1% (errors flat)" counted as a failure | **Fixed.** Status words are rejected as approvals; a failure needs an explicit FAIL, DOWN, or REGRESSED | engine tests `release fix R-19` (three) |
| R-20 | SHOULD_FIX | Eval fairness: LLM criteria scored in both arms required OS-specific process (04, 05, 13, 14, 15), and ADR-0004 contradicted the `arm: both` delegation graders | **Fixed before any two-arm run.** Criteria now describe outcomes and the report; ADR-0004 amended (delegation bounds score both arms) | case files; ADR-0004 amendment |
| R-21 | NIT | Docs vs code: "only blob objects are written"; MEDIUM+flag adversarial QA never enforced; `--timeout` unit; scope-judge reads `diff.*` instead of `signals.*`; "three runs by default"; incomplete non-source list; plan-check pointing at a file that product repositories don't have | **Fixed.** MEDIUM with any risk flag now requires adversarial QA in the registry (`reviewers_if_flagged`), router, and gate (PROC-6 made deterministic) | engine tests `route: MEDIUM with a risk flag adds adversarial QA`; hook tests `stop fix: MEDIUM with a risk flag requires adversarial QA` |
| R-22 | NIT | Test quality: a test locked in R-4; a crash counted as a killed mutation; "real index untouched" only grepped status; the ledger fingerprint test passed when both sides were null | **Fixed.** A mutation is killed only by a `FAIL` test line; this exposed `plan-cycle`, which was "killed" only by a stack overflow, and its test now catches it. The index is compared byte for byte; fingerprints must be non-null | `mutation-check.mjs`; engine and hook tests |
| R-23 | NIT | `--risk HIGH` rejected; real ACs containing `__` or `<tag>` rejected; "Not waived: auth (…)" parsed as a waiver | **Fixed.** Risk is case-insensitive; placeholders are stripped rather than rejecting the line; only a line starting with `Waived:` waives | engine test `route fix R-23`; hook test `stop fix R-23` |

## Claims the reviewer checked and found true

- Committing does not change the fingerprint. Untracked source files do change it; ASCII docs don't. The real index bytes are unchanged.
- Under `core.autocrlf=true`, a CRLF working copy and an LF commit give the same fingerprint.
- `arm: with-only` and `arm: both` are real case fields; the CLI's schema enum is `["with-only","both"]`.
- Router: risk is the maximum of the dimensions; an understated `--risk` is rejected; mandatory capabilities are staffed first; class restrictions hold; uncovered capabilities are reported.
- Plan-check enforces owner, DoR, DoD, and attempts.
- The release check and telemetry never print environment values or command text.
- The forgery forms that were already in the suite are denied.

## What this changes for users

See the [migration guide](../v3-migration.md). Two changes users will notice:
- **2.x evidence and verdicts no longer count.** Run `eng-verify` and the required reviews once after upgrading.
- **Partial runs no longer satisfy the gate.** The completion gate now wants a full `eng-verify` at the class's level (`--only` and `--skip` runs don't count).
