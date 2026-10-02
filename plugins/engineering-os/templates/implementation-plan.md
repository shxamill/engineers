# Implementation plan — <objective>
_Owner: orchestrator · Class: <class> · Updated: YYYY-MM-DD · Validate: `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-plan-check.mjs"`_

States: READY → RUNNING → REVIEW → VERIFICATION → DONE · BLOCKED · FAILED. Capability = registry id or `orchestrator`; Owner = `engineering-os:<that capability's agent>` or `orchestrator`. Same-wave tasks must have disjoint Files.
Ready = Files + AC ids + Verifier. Done = Evidence (verify run, log path, or commit). Attempts ≤ the class retry budget, else change strategy (note it, reset), eng-debug, or FAILED.

## Tasks
| ID | Objective | Capability | Owner | Depends | Wave | Files | AC | Verifier | Risk | Attempts | Evidence | State |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-1 | Walking skeleton: scaffold, one end-to-end path, test runner, lint, CI | orchestrator | orchestrator | - | 1 | `package.json` `src/**` `.github/**` | AC-1 | eng-verify standard | low | 0 | - | READY |
| T-2 | <vertical slice: behavior + persistence + tests> | backend | engineering-os:backend-engineer | T-1 | 2 | `src/api/users/**` `test/api/users*` | AC-2, AC-3 | `npm test -- users` | medium | 0 | - | READY |

## Acceptance coverage
| AC | Task(s) |
|---|---|

## Notes (blocked/failed reasons, decisions)
- 
