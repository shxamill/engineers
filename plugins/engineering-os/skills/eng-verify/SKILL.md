---
name: eng-verify
description: "F11: run the project's own checks plus test-tamper, secret, and scope checks; compact PASS/FAIL with evidence. Run before claiming code work is done."
argument-hint: [targeted|standard|full] [--only kinds] [--base ref] [--network]
---
# Verify (F11)

Run (from the project root; the level comes from the router budget, default standard):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-verify.mjs" "${CLAUDE_PROJECT_DIR}" $ARGUMENTS
```
- `targeted` = lint, typecheck, tests · `standard` = + build, format, secrets · `full` = + integration, e2e, security audits (add `--network` for registry audits).
- Checks come from `docs/engineering/project-profile.json` (`/engineering-os:eng-init`); without it they are detected live. Add or disable checks under `overrides` in the profile, never by editing the engine.

Output (paste these lines into your report; full logs stay in the EVIDENCE path):
```
BUILD: PASS · LINT: PASS · TYPECHECK: PASS · TESTS: PASS · E2E: NOT_RUN · SECRETS: PASS · TESTS-TAMPER: PASS · SCOPE: n files · VERDICT: PASS
```

Rules:
1. **FAIL** → read only the failing log tail (path in EVIDENCE), fix the cause, re-run with `--only <kind>`, then the full level. Retry budget: 2 attempts per approach, then `/engineering-os:eng-debug`.
2. **NOT_RUN is not PASS.** Report gaps honestly (e.g. "no typecheck configured"). Propose adding the missing check through the project profile, not a silent skip.
3. **TESTS-TAMPER FAIL** (deleted tests, new skip/only, or fewer assertions): restore the tests, or justify the change explicitly for the human and the reviewer. Never ship it silently.
4. **SECRETS FAIL:** remove the credential, use an env var, and treat the key as compromised (tell the human).
5. NO_CHECKS: the project has no runnable checks. Say so, and verify behavior another way (run the program and show its output).
6. The run writes `.eng/evidence/verify-latest.json`, which satisfies the Stop verification gate. A FAIL verdict still counts as evidence but must be reported as FAIL.
