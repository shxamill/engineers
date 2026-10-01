---
name: eng-spec
description: "F2-F3: requirements with acceptance criteria and verification methods; UX spec with all states for user-facing work."
argument-hint: [feature or scope]
---
# Specification (F2 requirements, F3 UX)

**Scope:** $ARGUMENTS (default: current objective in status.md)

1. **SMALL:** write 2–6 Given/When/Then acceptance criteria, each with its verification method, plus an out-of-scope line, directly into status.md. Done.
2. **MEDIUM+:** spawn `engineering-os:product-manager` with the intake block, `product.md`, and relevant `research.md` entries → `docs/engineering/requirements.md` (template `${CLAUDE_PLUGIN_ROOT}/templates/requirements.md`).
3. **User-facing:** after the requirements exist, spawn `engineering-os:ux-designer` → `docs/engineering/ux.md` (template `${CLAUDE_PLUGIN_ROOT}/templates/ux.md`). Sequential: UX depends on the requirements.
4. **F2 gate (you, not the author):**
   - every FR has ≥1 AC, and every AC has an objective verification method (test, check, or measurement)
   - NFRs have numbers: performance, availability, security (ASVS level), privacy, accessibility, observability, deployment, rollback
   - out-of-scope is explicit; the MVP is a thin vertical slice
   - a success metric exists for MEDIUM+ features (used by eng-outcome)
   - assumptions are labeled
5. **F3 gate (UI):** every screen covers empty/loading/error/success/permission states, long content, responsive behavior at 360/768/1280, keyboard and focus order, reduced motion, a11y, and copy. Engineers must not need to invent major behavior.
6. **Gaps:** one revision round with the author agent, then fix small gaps yourself. High-impact open decisions go to the human in one batch, with recommendations.
7. Update status.md (F2/F3 done or why not).
