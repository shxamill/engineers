# Engineering Status

## Now
- Objective: Router: mandatory risk capabilities take budget slots before trigger matches; leftovers printed as UNSTAFFED (PROC-16)
- Class: SMALL · Flags: none
- Phase: F11 verified (engine suite incl. mutation check, validator, hook suite, plugin validate); committed
- Current task: none
- Next actions: owner validates on a real product repository and in a live Windows session; owner decides the license (manifest says MIT, no LICENSE file)
- Blockers: none

## Phases
V2: F0 ✓ audit · F1 ✓ research · F2–F6 ✓ design (ADR-0002) · F7–F9 ✓ build · F10 ✓ verify · F11 ✓ benchmark runs 1–2 + re-run · F16 ✓ retro 0002

## Checks
`node plugins/engineering-os/scripts/validate-org.mjs` · `node plugins/engineering-os/scripts/verify-hooks.mjs` (255) · `node plugins/engineering-os/scripts/test-engines.mjs` (53) · `claude plugin validate plugins/engineering-os --strict` · org-ci green on Ubuntu + Windows since `afb6059` (Windows was red from the V2 commit until then; PROC-14). Suites also pass on Node 18.20.8.

## Planned (recorded so the README roadmap has a source)
- Re-benchmark cases 03 and 11 after PROC-13 (v2-run2 notes it is not yet benchmarked).
- Full benchmark with `runs: 3` per case to measure variance (retro 0002, Open).
- A no-plugin baseline comparison (`--ablation` not `none`): no result so far shows improvement over plain Claude Code.
- License decision (human gate: legal).
- Exploratory: deterministic checks for risk-flag deliverables, which today are enforced by instructions only.

## Risks
- Bash guard is heuristic (variables, aliases, generated scripts can evade it); the native sandbox is the boundary, the guard is defense in depth.
- Hooks are verified live on Linux and in CI on Windows; not yet in a live Claude Code session on Windows. Current docs: the sandbox is unsupported on native Windows (use WSL2).
- The benchmark uses Sonnet with 1 run per case; scores have run-to-run variance.
- Router: mandatory risk capabilities now win budget slots over trigger matches (PROC-16). One that still gets no slot (TRIVIAL; SMALL with two, e.g. `prod-data`) is printed as UNSTAFFED for the orchestrator to cover; that coverage is instructed, not checked (README Known limitations).

## Assumptions
- [ASSUMPTION] Node 18+ is on PATH wherever the plugin runs (hooks and engines need it).
- [ASSUMPTION] Product repos install the plugin from this marketplace; no OS files are copied into them.

## Completed (last 10)
- PROC-16: router staffs mandatory risk capabilities first and prints UNSTAFFED leftovers; 7 engine cases; eval 10 `ux-staffed` grader
- Documentation rebuild: README (concept → architecture → evidence → limits), plugin operating manual, CONTRIBUTING, docs index; research R-CC-11..17 and R-DOC
- PROC-14: Windows CI fixed (CRLF-agnostic test); CI verification step added to the contributor rules
- PROC-15: `worktree.baseRef: "head"` recommended; eng-build handles the default-branch base
- V2 audit (25 findings) and research log (R-CC/R-AG/R-ORG)
- Plugin + marketplace packaging; constitution injected by SessionStart/SubagentStart hooks
- Capability registry (31 capabilities) + router; detect / verify / plan-check engines
- 16 agents, 24 skills, F0–F16 lifecycle, Stop verification gate with gate ledger
- Hook suite 255 cases, engine suite 46 cases, CI on Ubuntu + Windows
- 15-case native eval benchmark; runs 1–2 analyzed; PROC-7..13 fixes
