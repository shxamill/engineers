# ADR-0003: Engineering OS V3 — evidence-bound gates, single-source registry, observable organization

_Status: accepted · Date: 2026-10-02 · Builds on ADR-0002 · Reversibility: easy (plugin versioned; 2.x evidence must be regenerated once)_

## Context

The V3 audit ([v3-audit](../v3-audit.md)) found five problems:

- **Forgeable proof.** Completion evidence could be satisfied by `touch` or forged from the shell (A-01, A-02; research E-3).
- **Unchecked classification.** Risk and risk flags were self-declared and never compared with what changed (A-04, A-05).
- **Displaced capabilities.** A mandatory capability could be pushed out of a SMALL budget (A-03).
- **Duplicated mappings.** The reviewer→skill mapping was hard-coded in two places (A-06).
- **Thin task contract.** The task model had no acceptance criteria, attempts, or evidence (A-07).

In addition, nothing measured the organization itself (A-13).

Research shows that instructions don't prevent evaluator tampering (AG-5) and that harnesses fail by declaring "done" prematurely (AG-1). It also shows that Claude Code's sanctioned deterministic gate is a Stop hook (CC-17).

## Decision

1. **Control-plane model (retained).** The main session is the orchestrator and owns the outcome. Workers' PASS verdicts count only through the gate ledger.
2. **Evidence model.** Verification results and reviewer verdicts are bound to a **content fingerprint** of the source tree, computed with a temporary git index and `write-tree`. The fingerprint is independent of commits and mtimes. Verification evidence is `verify-latest.json` schema 2: task, commit, fingerprint, and checks with status, command, and evidence. Evidence without a fingerprint is never current in a git repository (amended after the fresh-context review, R-4); time is compared only when no fingerprint can be computed.
3. **Evidence integrity.**
   - Guards deny shell and Edit/Write tampering with `.eng/evidence`, `.eng/state`, and `.eng/telemetry.jsonl`, and deny direct invocation of the ledger and gate hooks.
   - The gate cross-checks that the evidence directory exists and agrees.
   - This is explicitly not a boundary against a deliberately adversarial agent with the same OS user. CI and human review remain the independent verifiers.
4. **Capability routing (single source of truth).** `capabilities.yaml` gains:
   - `tiers` (low, medium, high mapped to model aliases);
   - `risk_dimensions`;
   - `gates` (classes per gate);
   - `risk_paths` (flag → path regex);
   - per-capability `tier`, plus `skill` and `reviewer_gate` for reviewers.

   The gate, router, and validator read only the registry. The router takes per-dimension scores, rejects understated risk, staffs required capabilities first, and logs every decision.
5. **Classification checks.** The completion gate requires each risk flag implied by changed paths (or by new dependencies) to be declared or waived with a reason. Acceptance criteria are required for SMALL+ and a completed plan for MEDIUM+, unless a skip is recorded with a reason.
6. **Execution model.** Plan rows add `AC`, `Attempts`, and `Evidence`. `eng-plan-check` enforces the Definition of Ready, the Definition of Done, owner↔capability consistency, and the retry budget. V2 tables are accepted with a warning.
7. **Release model.** `eng-release-check.mjs` makes the readiness checklist deterministic, including the human-approval field for production and names-only environment presence.
8. **Observability.** The router, hooks, and verifier append to a local `.eng/telemetry.jsonl`. `eng-status.mjs` renders a deterministic status and metrics view. The metrics are diagnostic and never targets.
9. **Context strategy (retained).** No new skills or agents are added. Footprint is budgeted in the validator: total description characters ≤ 5,600 (path-scoped standards included; V3 uses 5,080) and constitution ≤ 45 lines.
10. **Security boundary and plugin distribution.** Unchanged from ADR-0002, apart from item 3.

## Alternatives considered

| Option | Why not |
|---|---|
| Sign evidence with an HMAC key in `${CLAUDE_PLUGIN_DATA}` | Same-user agent can read the key (CC-10, CC-11); adds ceremony, not security |
| Stop hook re-runs the full verification itself | Unbounded hook time (test suites take minutes); duplicates `eng-verify`; still same-user |
| Block the stop repeatedly (up to the platform cap of 8) | Traps sessions on unresolvable conditions; once-per-attempt plus visible telemetry instead (A-19) |
| Path-based flags as hard requirements without waivers | False positives (`session/` in a non-auth context) would force unnecessary security reviews; recorded waivers keep the human-readable trail |
| Move orchestration into a dynamic workflow script | Not on every plan; suited to homogeneous fan-out, not dependent mixed-capability plans (CC-15) |
| A database or service for state and telemetry | Files and Git are enough at this scale (AG-3) |

## Consequences

- **Benefits:**
  - Committing after verification no longer forces re-verification.
  - Checkouts no longer cause false blocks.
  - `touch`ing or `echo`ing evidence no longer passes.
- **New work at completion:** agents must declare implied flags or record waivers, and must record ACs for SMALL+ work. That is more process, aimed at the failures observed in run 2.
- **Telemetry:** a new local file. It records guard reasons but never command text.
- **Platform dependency:** the fingerprint needs `git` on PATH (already required). If the fingerprint can't be computed, the gate compares times instead, so it fails open on its own errors, as in V2.
