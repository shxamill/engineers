---
name: eng-retro
description: F16 blameless retrospective or postmortem that turns repeated failures into project or Engineering OS process improvements.
argument-hint: [initiative or incident]
---
# Retrospective and process improvement (F16)

**Subject:** $ARGUMENTS

1. **Evidence, not memory:** status.md, the plan states, judge/review/QA verdicts, `.eng/evidence/` (verify summaries, debug logs), `git log`, outcomes.md.
2. **Write** `docs/engineering/retrospectives/NNNN-slug.md` (incidents: `${CLAUDE_PLUGIN_ROOT}/templates/postmortem.md`), ≤1 page: changed · worked · failed · surprises · follow-ups as tasks · lessons. Blameless: describe systems and decisions, not people or agents.
3. **Pattern check:** grep earlier retrospectives. A failure class seen twice (or once if severe) is a process defect. Fix the mechanism:
   | Symptom | Fix |
   |---|---|
   | testing omitted | strengthen the eng-verify level or the F11 gate |
   | unnecessary agent spawning | tighten registry triggers/budgets (`routing/capabilities.yaml`) |
   | repeated context waste | persist the fact (profile, status, research) or move it into an on-demand skill |
   | reviewers keep catching the same issue | add it to the matching `standards-*` skill |
   | security bypass | strengthen the control boundary (sandbox/permissions first, then hooks) |
   | architecture mistakes | strengthen eng-arch / the architect agent |
   | UI issues | add visual or a11y verification to test-plan and eng-verify overrides |
4. **Where the fix goes:** project-specific → the project's `docs/engineering/` or profile overrides. Generalizable → an Engineering OS change (plugin repo), plus a benchmark case in `evals/` that would have caught it.
5. **Validate OS changes** (in the plugin repo): `node scripts/validate-org.mjs && node scripts/verify-hooks.mjs && node scripts/test-engines.mjs`, plus the relevant `claude plugin eval` case.
6. **Log** each process change as `PROC-n` in `docs/engineering/decisions.md`.
