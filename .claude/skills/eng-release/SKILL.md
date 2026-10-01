---
name: eng-release
description: Release readiness (G9), deployment with human approval for production, post-deploy verification and outcome check (G10), and rollback. Writes release-plan.md.
argument-hint: [environment] [version]
---
# Release (Gates G9, G10)

**Target:** $ARGUMENTS

1. **Readiness (G9):** fill `docs/engineering/release-plan.md` from `templates/release-plan.md`. Every line needs evidence:
   build artifact valid · all gates for the class passed · tests green on the release commit · no open CRITICAL/HIGH security findings · migrations backward-compatible and rehearsed · config and secrets present in the target env (names only, never values) · monitoring and alerts in place · rollback procedure defined (and tested for CRITICAL) · release notes written.
2. **Human gate.** Production deploys, production migrations, DNS, paid resources, public package publishing, and external announcements need explicit approval. Present what will happen, the risk, the rollback, and the expected impact, then stop. Dev, preview, and staging deploys proceed without asking.
3. **Staged exposure** for risky releases where the platform supports it: feature flag, canary, or percentage rollout, with a promotion criterion.
4. **Deploy** via the platform-engineer or directly, following release-plan.md.
5. **Verify (G10):** smoke tests → health/readiness → key user journey → error rate and latency vs baseline → the outcome metric from requirements.md. Deployment success is not product success.
6. **Regression beyond threshold → roll back first, debug second** (`/eng-debug`).
7. **Record** the outcome in status.md. MEDIUM+ → run `/eng-retro`.
