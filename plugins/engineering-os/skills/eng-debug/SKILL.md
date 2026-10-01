---
name: eng-debug
description: "Forensic debugging of failing tests, builds, runtime errors, regressions, incidents: reproduce, isolate root cause, minimal fix, regression test."
argument-hint: <symptom, failing command, or error>
---
# Debug

**Symptom:** $ARGUMENTS

1. **Reproduce** with the exact failing command. Capture the output to `.eng/evidence/<slug>.log`; keep only the decisive excerpt in context.
2. **Triage the cause class:**
   - obvious from the error (typo, wrong import, missing await, missing config) → fix it directly, add or adjust a test, re-run. Done.
   - otherwise continue.
3. **Delegate or keep?** Spawn `engineering-os:debugger` when the investigation is log-heavy, spans unfamiliar layers, or would flood your context. Give it the exact repro command, the evidence path, what has been ruled out, and the scope it may change. Keep it yourself when you already hold most of the context.
4. **Forensic loop** (you or the debugger): evidence → 2–4 hypotheses → cheapest discriminating test → eliminate → root cause → minimal fix → regression test that fails before and passes after → run the surrounding suite.
5. **Anti-loop rule:** never repeat a failed action unchanged. After 2 failed fix attempts, change strategy (different layer, smaller repro, dependency source or changelog, official docs/issues, `git bisect`, instrumentation).
6. **Escalate** only with evidence: what was tried, what was eliminated, the remaining hypotheses, and the smallest decision or access needed.
7. **Record:** root cause + fix in status.md (Completed). If it is a recurring class of failure, queue `/engineering-os:eng-retro` to fix the process that let it through. Production incident → postmortem (`${CLAUDE_PLUGIN_ROOT}/templates/postmortem.md`). Finish with `/engineering-os:eng-verify`.
