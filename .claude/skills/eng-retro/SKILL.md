---
name: eng-retro
description: Blameless retrospective or postmortem after a release, incident, or rough task, turning repeated failures into concrete updates to the org's rules, skills, agents, or hooks (the self-improvement loop).
argument-hint: [initiative or incident]
---
# Retrospective & Process Improvement

**Subject:** $ARGUMENTS

1. **Evidence, not memory:** status.md, review and QA findings, debug logs in `.eng/evidence/`, `git log` for the initiative.
2. **Write** `docs/engineering/retrospectives/NNNN-slug.md` (incidents: use `templates/postmortem.md`), ≤1 page: what changed · what worked · what failed · surprises · follow-ups (as tasks) · lessons (architecture / testing / security / process). Blameless: describe systems and decisions, not people or agents.
3. **Pattern check:** grep earlier retrospectives for the same lesson. A failure class seen twice (or once if severe) is a process defect. Fix the mechanism:
   | Symptom | Fix |
   |---|---|
   | a step keeps being skipped | add it to the relevant skill checklist or gate |
   | reviewers keep catching the same issue | add a line to the path-scoped rule in `.claude/rules/` |
   | a rule is deterministic | enforce it with a hook instead of prose |
   | agents spawned needlessly or badly scoped | tighten `/eng` staffing or the agent description |
   | files or research repeatedly re-read | persist the fact in status.md, architecture.md, or research.md |
   | context bloat | move content from CLAUDE.md into a skill, rule, or file |
4. **Keep the org lean:** prune obsolete or duplicate rules when adding new ones. Every always-loaded line costs context in every session.
5. **Validate:** `node scripts/validate-org.mjs && node scripts/verify-hooks.mjs`.
6. **Log** each process change as `PROC-n` in `docs/engineering/decisions.md`.
