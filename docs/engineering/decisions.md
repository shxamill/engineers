# Decision Log
Durable decisions only, newest last. Significant or irreversible decisions get a full ADR in `adr/`. Process changes to the org itself are `PROC-n`.

| ID | Date | Decision | Why (one line) | Link |
|---|---|---|---|---|
| ADR-0001 | 2026-10-01 | Org structure: main-session orchestrator, 15 agents for 29 roles, forked review skills, path rules, Node hooks, lazy artifacts | Minimum always-loaded context with independent verification | [adr/0001](adr/0001-engineering-organization.md) |
| PROC-1 | 2026-10-01 | Independent review (G7) mandatory for every SMALL+ change; final report must show per-gate evidence | Bootstrap test: orchestrator skipped a line-count-conditional review; a $0.11 review caught 2 blocking bugs that passed tests | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-2 | 2026-10-01 | Files change only via Edit/Write; bash guard blocks credential-shaped strings in commands | Bootstrap test: 2 of 5 runs wrote files with python/cat heredocs, bypassing Edit/Write hooks | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-3 | 2026-10-01 | `/eng` commits verified work (feature branch if on default branch, stage own files only, never push unasked) | Bootstrap test: completed work left uncommitted; commit expectations were undefined | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
| PROC-4 | 2026-10-01 | Hook test suite renamed `scripts/verify-hooks.mjs` | `node --test` auto-discovers `**/test-*.mjs`, so a product's test run would pick up the org's suite | [retro 0001](retrospectives/0001-bootstrap-validation.md) |
