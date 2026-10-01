# Engineering Status

## Now
- Objective: Engineering OS V2 — audit, research, plugin implementation, benchmark (ADR-0002)
- Class: LARGE · Flags: none (tooling only; no product code)
- Phase: F16 done — V2 delivered; benchmark run 2 + re-run recorded (PROC-10..13), retrospective 0002 written
- Current task: none
- Next actions: owner installs the plugin on Windows and runs `/engineering-os:eng-init` in a real product repo
- Blockers: none

## Phases
F0 ✓ audit · F1 ✓ research · F2–F6 ✓ design (ADR-0002) · F7–F9 ✓ build · F10 ✓ verify (validator, hooks, engines, plugin validate) · F11 ✓ benchmark runs 1–2 + re-run · F15 ✓ retro 0002

## Checks
`node plugins/engineering-os/scripts/validate-org.mjs` · `node plugins/engineering-os/scripts/verify-hooks.mjs` (255) · `node plugins/engineering-os/scripts/test-engines.mjs` (46) · `claude plugin validate plugins/engineering-os --strict`

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
- Hook suite 255 cases, engine suite 46 cases, CI on Ubuntu + Windows
- 15-case native eval benchmark; runs 1–2 analyzed; PROC-7..13 fixes
