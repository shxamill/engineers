# Engineering Status

## Now
- Objective: Engineering org bootstrapped and validated (ADR-0001); ready for the first product goal
- Class: LARGE · Risk flags: none (no product code yet)
- Phase: idle — awaiting `/eng <goal>`
- Current task: none
- Next actions: owner verifies hooks fire on their Windows machine; give the org its first goal
- Blockers: none

## Gates
G0 ✓ · G1 ✓ · G2 – · G3 ✓ · G4 ✓ · G5 ✓ · G6 ✓ · G7 ✓ (2 review rounds, all findings fixed) · G8 ✓ · G9 – · G10 –

## Active work
| Task | Owner | State | Branch/worktree |
|---|---|---|---|

## Checks
`node scripts/validate-org.mjs` · `node scripts/verify-hooks.mjs`

## Risks
- Bash guard is heuristic (variables, aliases, generated scripts can evade it); it is a safety net, not a sandbox.
- Hooks are verified live on Linux and in CI on Windows, but not yet live in Claude Code on Windows.

## Assumptions
- [ASSUMPTION] Node 18+ is on PATH wherever this org runs (hooks need it).
- [ASSUMPTION] Products will be built in this repo or the org copied into product repos.

## Completed (last 10)
- Org config: CLAUDE.md, 15 agents, 14 skills, 8 rules, 5 hooks, 11 templates, validator, CI (Ubuntu + Windows)
- Live workflow tests t1–t6 in sandboxes (simple, medium ×2, review, recovery, debug, guards)
- PROC-1..6 process fixes from test evidence and two independent G7 reviews
- Hook suite: 224 cases, mutation-tested
- Retrospective 0001 recorded
