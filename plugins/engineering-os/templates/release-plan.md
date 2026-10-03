# Release Plan — <version> → <environment>
_Owner: platform-engineer / orchestrator · Date: YYYY-MM-DD · Human approval: <who, when> (required for production)_

## Environment path
LOCAL → CI → PREVIEW → STAGING → PRODUCTION (strike the ones this project doesn't have). Current target: <env>. Human approval required for PRODUCTION.

## Readiness checklist (every line needs evidence)
Status is `PASS` (with evidence) or `N/A` (with the reason in Evidence). Check with `eng-release-check.mjs --target <env>`.
| Item | Status | Evidence |
|---|---|---|
| Build artifact valid (commit/version) | | |
| All gates for class passed | | |
| Tests green on release commit | | |
| No open CRITICAL/HIGH security findings | | |
| Migrations backward-compatible & rehearsed | | |
| Config/secrets present in target (names only) | | |
| Monitoring, alerts, dashboards ready | | |
| Rollback procedure defined (tested for CRITICAL) | | |
| Release notes written | | |

## Service levels (meaningful services only; 1–3 rows)
| SLI | SLO | Rollback trigger |
|---|---|---|
| <e.g. availability of POST /orders> | <99.9% over 28 days> | <error rate > 2% for 5 min> |

## Rollout
<strategy: direct | feature flag | canary __% → __% | blue/green; promotion criterion; who watches>

## Rollback
<exact steps, time estimate, data considerations; trigger thresholds (error rate > __, p95 > __)>

## Post-deploy verification
| Check | Expected | Actual |
|---|---|---|
| Smoke tests | pass | |
| Health/readiness | 200 | |
| Key user journey | works | |
| Error rate vs baseline | ≤ __ | |
| Latency vs baseline | ≤ __ | |
| Outcome metric | trending to target | |

## Release notes
<user-facing changes, breaking changes + migration steps, known issues>
