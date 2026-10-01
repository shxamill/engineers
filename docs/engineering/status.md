# Engineering Status

## Now
- Objective: Engineering OS V2 — audit, research, plugin implementation, benchmark (ADR-0002)
- Class: LARGE · Flags: none (tooling only; no product code)
- Phase: F15 retrospective — benchmark run 2 under analysis
- Current task: record run-2 results, retrospective 0002, final validation
- Next actions: owner installs the plugin on Windows and runs `/engineering-os:eng-init` in a real product repo
- Blockers: none

## Phases
F0 ✓ audit · F1 ✓ research · F2–F6 ✓ design (ADR-0002) · F7–F9 ✓ build · F10 ✓ verify (validator, hooks, engines, plugin validate) · F11 ✓ benchmark run 1 · F15 in progress

## Checks
`node plugins/engineering-os/scripts/validate-org.mjs` · `node plugins/engineering-os/scripts/verify-hooks.mjs` (250) · `node plugins/engineering-os/scripts/test-engines.mjs` (45) · `claude plugin validate plugins/engineering-os --strict`

## Risks
- Bash guard is heuristic (variables, aliases, generated scripts can evade it); the native sandbox is the boundary, the guard is defense in depth.
- Hooks are verified on Linux live and on Windows only in CI; not yet live in Claude Code on Windows. The native sandbox on Windows is documented as unsupported (use WSL2) although the 2.1.286 binary contains Windows sandbox code.
- The benchmark uses Sonnet with 1 run per case; scores have run-to-run variance.

## Assumptions
- [ASSUMPTION] Node 18+ is on PATH wherever the plugin runs (hooks and engines need it).
- [ASSUMPTION] Product repos install the plugin from this marketplace; no OS files are copied into them.

## Completed (last 10)
- V2 audit (25 findings) and research log (R-CC/R-AG/R-ORG)
- Plugin + marketplace packaging; constitution injected by SessionStart/SubagentStart hooks
- Capability registry (31 capabilities) + router; detect / verify / plan-check engines
- 16 agents, 24 skills, F0–F16 lifecycle, Stop verification gate with gate ledger
- Hook suite 250 cases, engine suite 45 cases, CI on Ubuntu + Windows
- 15-case native eval benchmark; run 1 analyzed; PROC-7..11 fixes
