---
name: eng-release
description: "F12-F14: release readiness, gated deploy (human approval for production), staged rollout, post-deploy verification, rollback."
argument-hint: [environment] [version]
---
# Release (F12 readiness → F13 deploy → F14 post-deploy)

**Target:** $ARGUMENTS

Environments: LOCAL → CI → PREVIEW → STAGING → PRODUCTION. Use only those the project has (`project-profile.json` deploy/ci). Record the path in the release plan.

1. **Readiness (F12):** fill `docs/engineering/release-plan.md` from `${CLAUDE_PLUGIN_ROOT}/templates/release-plan.md`. Every line needs evidence:
   - build artifact identified
   - `eng-verify full` PASS on the release commit
   - no open CRITICAL/HIGH security findings
   - migrations backward-compatible and rehearsed
   - compatibility with running clients
   - config and secrets present in the target, checked by **name only**
   - monitoring and alerts in place
   - rollback defined (and tested for CRITICAL)
   - release notes
2. **Gate (F13):** dev, preview, and staging deploys proceed. Production deploys, production migrations, DNS, paid resources, public publishing, and announcements need explicit human approval. Present what, risk, rollback, and expected impact, then stop. The guard hooks also prompt for these commands.
3. **Staged exposure** for risky changes, where supported: feature flag → canary → percentage rollout → full. Each promotion has a criterion (error rate, latency, key journey).
4. **Deploy** (platform-engineer or directly), following release-plan.md.
5. **Post-deploy verification (F14):** health/readiness → smoke tests → core user journey → error rate and latency vs baseline → resource health. Store evidence under `.eng/evidence/release-<version>/`.
6. **Regression beyond threshold → roll back first, debug second** (`/engineering-os:eng-debug`). Incidents above the postmortem threshold (user-visible impact, data risk, or rollback in production) → postmortem from `${CLAUDE_PLUGIN_ROOT}/templates/postmortem.md`.
7. **Record:** release state in status.md. Report "Code deployed" separately; the outcome is measured later by `/engineering-os:eng-outcome`.
