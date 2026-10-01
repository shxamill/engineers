---
name: eng-spec
description: Produce requirements (FR/NFR/acceptance criteria/out-of-scope) and, for user-facing work, the UX spec. Gates G1 Requirements and G2 Design.
argument-hint: [feature or scope]
---
# Specification (Gates G1, G2)

**Scope:** $ARGUMENTS (default: current objective in status.md)

1. **SMALL:** write 2–6 Given/When/Then acceptance criteria plus an out-of-scope line directly into status.md under the task. Done; skip the rest.
2. **MEDIUM+:** spawn `product-manager` with the intake block, `product.md`, and relevant `research.md` entries → `docs/engineering/requirements.md` (template `docs/engineering/templates/requirements.md`).
3. **User-facing:** after requirements exist, spawn `ux-designer` → `docs/engineering/ux.md` (template `ux.md`). Run it sequentially; UX depends on requirements.
4. **Gate G1 check (you, not the author):**
   - every FR has ≥1 testable AC; every AC maps to an FR
   - NFRs have numbers (latency, availability, limits), including security, privacy, accessibility, observability, rollback
   - out-of-scope is explicit; the MVP is a thin vertical slice
   - assumptions are labeled; high-impact decisions are listed
5. **Gate G2 check (UI):** every screen has all states (empty/loading/error/success/permission), responsive behavior at 3 widths, keyboard and focus order, a11y notes, and copy. Developers should not need to invent UX.
6. **High-impact open decisions** → one batched question to the human with recommendations. Gate fails → send precise gaps back to the author agent (one revision round), then fix small gaps yourself.
7. Update status.md: G1/G2 passed (or why not), next phase.
