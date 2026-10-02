# ADR-0004: Evaluation model — two-arm, repeated, outcome-graded benchmark

_Status: accepted · Date: 2026-10-02 · Supersedes the single-arm method of benchmark runs 1–2 · Reversibility: easy_

## Context

V2 benchmark runs 1–2 used `--ablation none` and one run per case (audit A-31, A-32). That gives no evidence the OS beats plain Claude Code, and single runs are noisy. Claude Code's eval runner supports a no-plugin baseline arm and recommends three runs per case (research CC-13). Graders that can only pass with the plugin should be marked `with-only` so they don't inflate Δ. Agent-eval guidance says to grade outcomes, not paths, and to distinguish pass@k from pass^k (AG-2).

## Decision

1. **Two arms.** Every benchmark compares Engineering OS (with-arm) against plain Claude Code (without-arm), with identical prompts. The baseline receives `/engineering-os:eng …` as plain text and acts on the goal (research E-2).
2. **Three runs per case** by default.
3. **Two grader classes:**
   - **Outcome graders**, scored in both arms: correctness (file content, tests), security (no hardcoded secret, safe comparison), scope (no unrelated edits), test integrity (no skips or deletions), and safety (work survives, no secret in the transcript).
   - **Process graders**, marked `arm: with-only` and reported as diagnostics, not in Δ: the VERDICT line, org agent names, review ran, and delegation bounds.
4. **What a report includes:**
   - per case: with and without means, Δ, pass^3 in each arm, and cost per arm;
   - suite: means, the number of cases where the OS is better, worse, or tied, and total cost;
   - always: model, Claude Code version, runs, environment, graders, and limitations.
5. **Honesty rules:**
   - Separate runs are never aggregated.
   - Partial runs are labelled partial.
   - Projections are never presented as results.
   - Every case or grader change is noted, because it changes comparability with earlier runs.
6. **Ablations beyond with and without** (for example, OS without the completion gate) are run only when a specific decision depends on them. Each is cost-capped and reported separately.
7. **Regression vs capability.**
   - **Regression suite:** cases 01, 07, 08, 13, 14, 15, 16 cover gates, guards, and scope.
   - **Capability suite:** the rest.

   A regression case failing after an OS change blocks the release of that change.

## Consequences

- Costs roughly 6× a single-arm, single-run suite. Capped with `--max-cost-usd`, so a run that hits the cap is reported as partial.
- Results are not comparable with V2 runs 1–2, which used a different method. Those stay published as they were.
- A Δ ≤ 0 is a real finding, not a failure to hide. It means the OS adds cost without measured benefit on that case.
