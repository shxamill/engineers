---
paths:
  - "docs/engineering/**"
---
# Engineering artifact rules
- Artifacts are durable state, not logs: compact, current, factual. Update in place; delete what is stale.
- `architecture.md` describes the actual system; mark anything not built yet as `PLANNED`.
- Never paste logs, source files, or transcripts. Link paths and put large evidence under `.eng/evidence/`.
- `status.md`: the Now section stays ≤15 lines (a hook injects it into every session); Completed keeps the last 10 entries.
- Stable IDs, never renumbered: FR-n, NFR-n, AC-n, T-n, R-n, ADR-NNNN, PROC-n.
- Label assumptions `[ASSUMPTION]` and never present them as facts. Never invent business facts.
- New artifacts start from `docs/engineering/templates/`; drop template sections that don't apply instead of filling them with filler.
