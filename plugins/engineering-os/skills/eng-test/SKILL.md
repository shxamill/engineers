---
name: eng-test
description: "Test strategy: map acceptance criteria to tests, fill coverage gaps, and run adversarial QA for large or risk-flagged work."
argument-hint: [scope]
---
# Test strategy and adversarial QA (part of F9/F11)

**Scope:** $ARGUMENTS (default: current objective)

1. **Coverage map** (MEDIUM+): `docs/engineering/test-plan.md` from `${CLAUDE_PLUGIN_ROOT}/templates/test-plan.md`, as an AC → test → result table. An AC without a test is a gap.
2. **Layers by class:** SMALL — unit tests for touched behavior. MEDIUM — + integration/API/component. LARGE — + e2e golden paths, a11y for UI. CRITICAL — + security tests, performance vs NFRs (reliability-engineer), migration rehearsal, rollback test.
3. **Gaps** → a `qa`/`test-automation` task for `engineering-os:test-engineer`, with the exact missing ACs and failure modes.
4. **Adversarial QA** (LARGE+, or MEDIUM with a risk flag): spawn `engineering-os:adversarial-qa` (read-only; it can run in parallel with code review). Each reproducible failure → fix through the owner or eng-debug, plus a regression test.
5. **Run** `/engineering-os:eng-verify` at the class level and record the counts in test-plan.md.
6. Never weaken, skip, or delete a test to pass. Flaky = defect: find the cause.
