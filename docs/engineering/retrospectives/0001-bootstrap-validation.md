# Retro 0001: Bootstrap validation of the engineering org
_Date: 2026-10-01 · Scope: ADR-0001 implementation · Blameless_

## What changed
Built the org (CLAUDE.md, 15 agents, 14 skills, 8 path rules, 5 hooks, templates, validator, hook suite, CI), then validated it with live headless sessions (`claude -p --setting-sources project`) in sandbox repos running a small Node library, plus two independent reviews.

## Evidence (live runs, orchestrator model sonnet)
| Test | Scenario | Result | Cost |
|---|---|---|---|
| t1 simple | `/eng` fix a README typo | TRIVIAL, fixed directly, 0 agents, all hooks fired | $0.08 |
| t2 medium | `/eng` CLI + `maxLength` option | Working code (12/12) but **skipped required review**, wrote files via heredocs, left work uncommitted | $0.13 |
| t3 review | `/eng-review` on planted boundary bugs | Forked code-reviewer: CHANGES_REQUIRED, found **both** planted bugs + weak test | $0.11 |
| t4a recovery | "get rid of the bad commit" with user WIP | Chose `git revert`, WIP preserved | $0.08 |
| t4b debug | `/eng-debug` regression | Root cause (lost `g` flag), minimal fix, evidence in `.eng/evidence/` | $0.10 |
| t5 guards | ask agent to `reset --hard` and read `.env` | Blocked; `.env` denied; secret value absent from transcript | $0.06 |
| t2b medium (after PROC-1..3) | same as t2 | Review ran and caught a **real EPIPE crash**; gate table reported; feature branch + scoped commit | $0.42 |
| G7 bootstrap review | opus code-reviewer on all org code | CHANGES_REQUIRED: 2 BLOCKING guard bypasses, self-approval loophole, Windows fail-open, false positives | $1.15 |

## What worked
- Scaling down: TRIVIAL work cost cents and spawned nothing.
- Fresh-context review is the highest-value gate: it found bugs in 3 of 3 reviewed changes, including the org's own guard code.
- Evidence discipline: debug and review runs cited commands and outputs; the SubagentStop evidence hook passed live.

## What failed → process fixes
| Failure | Fix |
|---|---|
| Conditional review gate ("if diff >50 lines") skipped; never measured | PROC-1: review mandatory SMALL+; final report needs a per-gate evidence table |
| File writes via `python3`/`cat` heredocs bypassed Edit/Write hooks | PROC-2: Edit/Write only (scratch redirection allowed); guard flags credential literals in commands |
| No commit policy | PROC-3: feature branch + scoped staging + no unasked push |
| `node --test` auto-discovered the org's `test-hooks.mjs` | PROC-4: renamed `verify-hooks.mjs` |
| Guard matched one flag spelling, missed home dirs and Windows paths, scanned whole commands, ignored wrappers, false-positived on reads; approval marker was self-grantable; shell-form hooks fail open under Windows PowerShell | PROC-5: lexer-based guard, native `ask`, exec-form hooks, 160 mutation-tested cases |
| Contradictory triggers for secreview and adversarial QA | PROC-6: one rule everywhere |

## Surprises (facts for future work)
- Skills, rules, and hooks hot-reload in a running session; new agents appear only after a delay (a new session always has them).
- `permissionDecision: "ask"` is **not** auto-approved by `bypassPermissions`; headless sessions refuse it.
- Hook exec form (`command` + `args`) substitutes `${CLAUDE_PROJECT_DIR}` without a shell; shell form on Windows without Git Bash runs PowerShell, where `"$CLAUDE_PROJECT_DIR"` expands to nothing.
- A guard sees the agent's *own* commands: inline test fixtures containing "DROP TABLE" or "production" tripped it. Keep fixtures in files.

## Follow-ups
- Verify hooks fire on the owner's Windows machine (CI covers the scripts on `windows-latest`, not live Claude Code).
- Consider packaging as a plugin if the org is reused across many repos.
