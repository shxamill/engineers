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
BUILD: PASS · LINT: PASS · TYPECHECK: NOT_APPLICABLE (reason) · TESTS: PASS · E2E: NOT_RUN · SECRETS: PASS · TESTS-TAMPER: PASS · SUPPLY-CHAIN: PASS · SCOPE: n files (+a/-r lines) · VERDICT: PASS
```

Rules:
1. **FAIL** → read only the failing log tail (path in EVIDENCE), fix the cause, re-run with `--only <kind>`, then the full level. Retry budget: 2 attempts per approach, then `/engineering-os:eng-debug`.
2. **NOT_RUN is not PASS.** Report gaps honestly (e.g. "no typecheck configured"). Propose adding the missing check through the project profile, not a silent skip.
3. **TESTS-TAMPER FAIL** (deleted tests, new skip/only, or fewer assertions): restore the tests, or justify the change explicitly for the human and the reviewer. Never ship it silently.
4. **SECRETS FAIL:** remove the credential, use an env var, and treat the key as compromised (tell the human).
5. NO_CHECKS: the project has no runnable checks. Say so, and verify behavior another way (run the program and show its output).
6. NOT_APPLICABLE only when declared in the profile (`overrides.notApplicable: {"typecheck": "plain JS"}`); otherwise a missing kind is NOT_RUN, a gap to report.
7. **SUPPLY-CHAIN FAIL** (`permissions: write-all`, `pull_request_target` + PR-head checkout): fix the workflow. WARN (unpinned action, manifest without lockfile): fix or justify. New dependencies listed → declare the `new-dependency` flag (license, maintenance, advisories, pinned version).
8. The run writes `.eng/evidence/verify-latest.json` (schema 2, bound to the current content fingerprint), which satisfies the Stop verification gate until source changes; committing doesn't invalidate it. A FAIL verdict still counts as evidence but must be reported as FAIL. Pass `--task T-n` when verifying a plan task. Never edit evidence files; the guards deny it.
