# Decision Log
Durable decisions only, newest last. Significant or irreversible decisions get a full ADR in `adr/`. Process changes to the org itself are `PROC-n`.

| ID | Date | Decision | Why (one line) | Link |
|---|---|---|---|---|
| ADR-0001 | 2026-10-01 | Org structure: main-session orchestrator, 15 agents for 29 roles, forked review skills, path rules, Node hooks, lazy artifacts | Minimum always-loaded context with independent verification | [adr/0001](adr/0001-engineering-organization.md) |
| PROC-1 | 2026-10-01 | Independent review (G7) mandatory for every SMALL+ change; final report must show per-gate evidence | Bootstrap test: orchestrator skipped a line-count-conditional review; a $0.11 review caught 2 blocking bugs that passed tests | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-2 | 2026-10-01 | Files change only via Edit/Write; bash guard flags credential-shaped strings in commands | Bootstrap test: 2 of 5 runs wrote files with python/cat heredocs, bypassing Edit/Write hooks | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-3 | 2026-10-01 | `/eng` commits verified work (feature branch if on default branch, stage own files only, never push unasked) | Bootstrap test: completed work left uncommitted; commit expectations were undefined | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-4 | 2026-10-01 | Hook test suite renamed `scripts/verify-hooks.mjs` | `node --test` auto-discovers `**/test-*.mjs`, so a product's test run would pick up the org's suite | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-5 | 2026-10-01 | Guards use native `permissionDecision: "ask"` (human approves; no self-grantable marker); hooks run in exec form; bash guard rebuilt on a quote/heredoc-aware lexer with per-segment checks and read-only exemptions | Independent G7 review of the bootstrap: 2 BLOCKING bypasses, self-approval loophole, Windows PowerShell fail-open, read-only false positives | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-6 | 2026-10-01 | One rule for extra gates: risk flag ⇒ `/eng-secreview` at every class; adversarial QA at LARGE+ or MEDIUM with a risk flag; scratch redirection allowed under `.eng/evidence/` | G7 review found contradictory triggers across `/eng`, eng-test, and agent descriptions | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
