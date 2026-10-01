---
name: eng-arch
description: "F4-F5: architecture (simplest design that meets requirements, ADRs) and design-time threat model for MEDIUM+ or risk-flagged work."
argument-hint: [focus]
---
# Architecture and threat model (F4, F5)

**Focus:** $ARGUMENTS

1. **TRIVIAL/SMALL:** no architecture doc. A new dependency, datastore, external service, or public interface → a one-line decision in `docs/engineering/decisions.md` (ADR if irreversible), and a supply-chain check for new dependencies.
2. **Design:** spawn `engineering-os:architect` with `requirements.md` (+ `ux.md`, `research.md` entries) and the intake notes on the existing system → `docs/engineering/architecture.md` + ADRs.
   - Competing approaches on an expensive-to-reverse decision (LARGE/CRITICAL only): 2 architects in parallel with different briefs ("simplest operable" vs "scale-ready"), each returning a ≤1-page option instead of writing files. Choose or merge, then one architect writes the docs.
3. **Justify complexity:** microservices, queues, event buses, distributed caches, extra databases, or expensive infrastructure each need a named requirement that forces them. Otherwise remove them.
4. **Threat model (F5)** (any risk flag, or MEDIUM+ with user data, auth, or external input): spawn `engineering-os:security-engineer` in THREAT MODEL mode → `docs/engineering/security.md`. Its mitigations become ACs or plan tasks.
5. **F4 gate:** defined boundaries, components, APIs/contracts, data flows and ownership, dependencies, authN/Z, persistence, caching, failure modes, observability, deployment, rollback, and scale assumptions.
6. **F5 gate:** every HIGH/CRITICAL threat has a mitigation or an explicitly accepted risk. Accepting a HIGH+ risk is a human decision.
7. **Irreversible decisions** (datastore, cloud/vendor, paid service, public API shape, data model of record) → human gate with the ADR summary, options, and a recommendation.
