---
name: standards-frontend
description: "Frontend standards: all UI states, WCAG 2.2 AA, responsive widths, client-side security, component reuse."
user-invocable: false
paths:
  - "**/*.{tsx,jsx,vue,svelte,astro}"
  - "**/*.{css,scss,sass,less}"
  - "**/{components,pages,views,screens,ui,hooks,styles}/**"
---
# Frontend rules
- Implement `docs/engineering/ux.md` when it exists; don't invent major UX. Missing decision → minimal choice + flag it.
- Every data-driven view handles loading, empty, error, and success, plus long strings and slow networks.
- Accessibility (WCAG 2.2 AA): semantic elements, labelled inputs, alt text, visible focus, full keyboard operation, no color-only meaning, contrast ≥4.5:1, honor `prefers-reduced-motion`.
- Responsive: check 360 / 768 / 1280 px.
- Security: only public env vars reach the client; never inject unsanitized HTML; the server re-validates everything.
- Reuse existing components and tokens. A new UI/state library needs a decision entry.
- Performance: watch bundle impact when adding dependencies; lazy-load heavy routes; avoid needless re-renders.
- Tests assert user-visible behavior (role/label queries), not implementation details.
