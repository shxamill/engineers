---
name: eng-outcome
description: "F15: measure whether a shipped feature achieved its success signal, separately from deployment; poor outcomes return to discovery."
argument-hint: [feature or FR id]
---
# Outcome evaluation (F15)

**Feature:** $ARGUMENTS

1. **Signal:** read the success metric for this feature from `docs/engineering/requirements.md` (Success metrics) or `product.md`. If none was defined, define one now with the human's agreement (metric, baseline, target, window, data source) and record it. Don't invent numbers.
2. **Measure:** gather evidence from real sources only: analytics or metrics exports, logs, error trackers, latency dashboards, support counts, or the data the human provides. Store raw extracts under `.eng/evidence/outcome-<slug>/`. If no data is reachable, the verdict is UNMEASURABLE; say what instrumentation is missing.
3. **Judge** against baseline and target, over the agreed window: `ACHIEVED | PARTIAL | NOT_YET (window open) | MISSED | UNMEASURABLE`. Note confounders (seasonality, concurrent launches, low sample size).
4. **Record** one row in `docs/engineering/outcomes.md` (create it if missing): `date | feature | signal | baseline | target | observed | verdict | evidence path`.
5. **Act:**
   - MISSED or PARTIAL: re-enter F1 discovery (why didn't users or the system behave as expected?) before writing more code, and queue `/engineering-os:eng-retro`.
   - UNMEASURABLE: create an instrumentation task (reliability-engineer or product-analytics).
   - ACHIEVED: note it in status.md. Done.
Report both facts separately: "Code deployed: <yes/no + evidence>" and "Intended outcome: <verdict + evidence>".
