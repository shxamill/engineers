# Engineering OS V3 benchmark — run 1 (invalid as a suite)

_Claude Code 2.1.287 · plugin 3.0.0 at commit `746cd61` (run from a `git archive` snapshot) · method [ADR-0004](../adr/0004-evaluation-model.md): two arms, 3 runs per case, Sonnet orchestrator, Haiku judges · concurrency 6 · started 2026-10-02T11:48Z · wall time 419 s · runner-reported cost $10.66_

## Verdict

**This run does not measure the suite.** Seven minutes in, the account hit its usage session limit ("You've hit your session limit · resets 3:40pm (UTC)"). From then on, runs in both arms ended immediately with an error: **70 of 96 runs errored** (37 with the plugin, 33 without).

The runner still scored the errored runs. Graders such as `not_contains` and "file untouched" pass on a workspace nobody edited, so an errored run can score 0.25–0.75. The runner's suite figures are therefore meaningless and are **not reported as results**: mean 0.55 vs 0.51, pass^3 1/16 vs 2/16, mean Δ +0.03.

The Windows-only path bug fixed in `b54100c` doesn't affect this Linux run.

## The only valid comparison: cases 01–03

These three cases completed all 3 runs in both arms with no errors. Three cases are far too few to say anything about the suite.

| Case | With plugin: scores | Without: scores | Δ mean | pass^3 with / without | Cost with / without | Turns with / without (mean) |
|---|---|---|---|---|---|---|
| 01 trivial change | 1, 1, 0.67 | 1, 1, 0.67 | 0.00 | ❌ / ❌ | $0.32 / $0.15 | 6.0 / 3.0 |
| 02 simple bug | 0.75, 0.75, 1 | 1, 1, 1 | **−0.17** | ❌ / ✅ | $0.52 / $0.18 | 12.7 / 4.0 |
| 03 medium feature | 1, 1, 1 | 1, 1, 1 | 0.00 | ✅ / ✅ | $2.66 / $0.26 | 30.7 / 4.0 |

Notes:
- **01:** In each arm, one run failed `proportional-process`, an LLM judge on the final message (votes FAIL FAIL FAIL with the plugin, FAIL FAIL PASS without). The typo fix itself passed in all 6 runs, and neither arm delegated.
- **02:** The plugin arm fixed the bug, kept the tests, and verified with `eng-verify` in all 3 runs (VERDICT indicator 3/3). In 2 of 3 runs, however, the judge found that the final report did not state the root cause clearly (`root-cause-reported`: FAIL FAIL FAIL). Plain Claude Code passed it 3/3. **This is a real regression signal against the OS:** its longer, gate-oriented report buried the one-line root cause.
- **03:** Both arms passed every outcome grader. The plugin arm cost **about 10×** as much ($2.66 vs $0.26) and took about 8× the turns. The OS's own process indicator `lifecycle-quality` failed 3/3: the judge did not find the per-phase gate table and review evidence it expects. That indicator is excluded from the score by design (`arm: with-only`), but it means the OS didn't follow its own reporting contract.
- **04 (incomplete):** In the 2 plugin runs that finished, the judge failed `slice-quality`, as it did in all 3 baseline runs. The third plugin run errored on the limit.

## What can and cannot be concluded

- **Cannot:** whether Engineering OS beats plain Claude Code on this suite. The cases where the OS is expected to matter most (security 05, destructive commands 13, secrets 14, scope 15, verification evasion 16) all errored in both arms.
- **Can (on 3 small cases only):**
  - The OS showed no outcome advantage on trivial, simple-bug, and medium-feature work.
  - It cost 2–10× more.
  - It did worse on one reporting criterion (02).

  This agrees with the V2 caveat that the process overhead is not free, and gives retrospective input for the reporting contract (02, 03).

## Next run

Re-run the full suite with the same command after the limit resets, against the current head. Use lower concurrency (`-j 3`) so one usage window covers it, and keep `--max-cost-usd 60`. Excluding errored runs from the score needs a runner change; until then, any run with errors is reported per case, as here.

## Reproduce

From a snapshot of the commit's `plugins/engineering-os`:

```bash
claude plugin eval . --scaffold --trust-plugin --allow-tools Bash Write Edit \
  --runs 3 --model sonnet -j 6 --no-publish --max-cost-usd 60 --json results.json
node scripts/bench-summary.mjs results.json
```
