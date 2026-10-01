---
name: eng-test
description: Verification gate G8 - choose layered checks for the risk level, map acceptance criteria to tests, fill coverage gaps with test-engineer, run adversarial QA for LARGE+ or risk-flagged MEDIUM work, and record results.
argument-hint: [scope]
---
# Verification (Gate G8)

**Scope:** $ARGUMENTS (default: current objective)

1. **Discover the check commands once** (package.json scripts, pyproject/Makefile, CI workflow) and record them in status.md → Checks so nobody rediscovers them.
2. **Layers by class:**
   | Class | Required |
   |---|---|
   | TRIVIAL | the one relevant check (build, lint, or the affected test) |
   | SMALL | lint + typecheck + unit tests for the touched area |
   | MEDIUM | + integration/API/component tests; AC → test coverage table |
   | LARGE | + e2e golden paths, accessibility checks for UI, `adversarial-qa` |
   | CRITICAL | + security tests, performance/load vs NFRs (`reliability-engineer`), migration rehearsal, rollback test |
3. **Coverage gaps** (an AC without a test, or an untested failure mode) → `test-engineer` task with the exact gaps.
4. **Adversarial QA** (LARGE+, or MEDIUM with a risk flag): spawn `adversarial-qa` (read-only; can run in parallel with code review). Each reproducible failure → fix via owner or `/eng-debug`, plus a regression test.
5. **Run everything required yourself at the end** on the integrated tree. Full logs → `.eng/evidence/`; keep counts and failures in context.
6. **Rules:** never weaken, skip, or delete a test to pass. Flaky = defect; find the cause. A failure unrelated to the change is still reported, with evidence it pre-exists (e.g. it also fails on the base commit).
7. **Record:** test-plan.md AC → test → result table (MEDIUM+); status.md G8 with command and pass/fail counts.
