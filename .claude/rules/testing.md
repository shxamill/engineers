---
paths:
  - "**/*.{test,spec}.*"
  - "**/{test,tests,__tests__,e2e,cypress,playwright,spec}/**"
  - "**/test_*.py"
  - "**/*_test.{py,go}"
  - "**/conftest.py"
---
# Testing rules
- Test behavior and failure modes, not implementation details. One reason to fail per test; clear Arrange-Act-Assert.
- Deterministic: control time, randomness, and network; no sleeps (wait on conditions); isolated data per test; no order dependence.
- Mock only at system boundaries (network, clock, third-party and model APIs), never the unit under test.
- A new test must be able to fail: check it against broken behavior before trusting it.
- Regression tests reproduce the original bug and say so in their name.
- Never delete, skip, weaken, or loosen assertions to get green. Flaky = defect.
- E2E covers golden paths and critical flows only; push detail down to unit and integration tests.
- Snapshot tests sparingly, and never as the only assertion of behavior.
