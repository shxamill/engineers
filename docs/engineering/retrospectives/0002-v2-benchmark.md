# Retrospective 0002 — Engineering OS V2 benchmark (runs 1–2)

## What happened
The native `claude plugin eval` suite has 15 cases, runs on Sonnet, with 1 run per case.
- Run 1 scored 0.87 mean, 8/15 passed, at $2.80.
- Run 2, after PROC-7..11, scored 0.90 mean, 9/15 passed, at $9.16.
- Run 2 passed every deterministic grader: verification ran, guards held, nothing leaked, scope was respected, and no test was weakened.
- The remaining failures are all quality judges reading the final report.

## What worked
- **Enforcement moved from prose to hooks.** Run 1 repeated the V1 failure of skipping review (03/04) and shipping an open finding (05). The gate ledger plus the Stop gate (PROC-7/8/11) eliminated both in run 2.
- **Baseline-aware verify (PROC-10).** Pre-existing lint no longer fails a scoped change (15 passed).
- **Guards held in every adversarial case.** That covers the destructive reset (13), the secret read (14), and scope bait (15).

## What didn't
1. **Self-classification drifts low.** 5 of the 6 failed cases were declared SMALL. An agent minimizes its own gates when the rule allows judgment. Mitigation (PROC-12): concrete tie-break rules. This is still self-reported; a deterministic check (the diff file count vs the declared class in the Stop gate) is the next step if drift persists.
2. **"Mandatory" without a named deliverable is ignored.** The router said `ai-ml (risk:ai)`, yet no eval set was produced. Naming the evidence each flag requires (`risk_deliverables`) makes the obligation checkable.
3. **The report is the product's interface.** Good work (05) failed review because the report didn't show the evidence. Humans read reports the same way. The acceptance table maps criterion → evidence.
4. **Enforced review has a cost.** Real review loops tripled cost. The loops are now capped by the retry budget, and extra hardening becomes a follow-up.
5. **Measurement hygiene.** Traces are deleted unless `--keep-temp` is passed, so diagnosing from judge evidence alone left 06 unexplained. `--case` takes a single glob (no braces). The harness writes dotfiles into the workspace.

## Process changes
PROC-10, PROC-11, PROC-12 (see `decisions.md`). For benchmark runs: always pass `--keep-temp` on re-runs of failed cases, and run each case as a separate invocation.

## Open
- Judge variance is unmeasured (1 run per case). Use `runs: 3` before drawing conclusions from a single case.
- No live run on Windows yet.
