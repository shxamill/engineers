# Implementation plan — <objective>
_Owner: orchestrator · Class: <class> · Updated: YYYY-MM-DD · Validate: `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-plan-check.mjs"`_

States: READY → RUNNING → REVIEW → VERIFICATION → DONE · BLOCKED · FAILED. Capability = registry id or `orchestrator`. Same-wave tasks must have disjoint Files.

## Tasks
| ID | Objective | Capability | Owner | Depends | Wave | Files | Verifier | Risk | State |
|---|---|---|---|---|---|---|---|---|---|
| T-1 | Walking skeleton: scaffold, one end-to-end path, test runner, lint, CI | orchestrator | orchestrator | - | 1 | `package.json` `src/**` `.github/**` | eng-verify standard | low | READY |
| T-2 | <vertical slice: behavior + persistence + tests> | backend | engineering-os:backend-engineer | T-1 | 2 | `src/api/users/**` `test/api/users*` | `npm test -- users` | medium | READY |

## Acceptance coverage
| AC | Task(s) |
|---|---|

## Notes (blocked/failed reasons, decisions)
- 
