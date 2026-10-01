---
name: eng-arch
description: Architecture and threat modeling for MEDIUM+ work - architect produces architecture.md and ADRs, security-engineer produces the threat model. Gates G3 Architecture and G4 Security.
argument-hint: [focus]
---
# Architecture & Threat Model (Gates G3, G4)

**Focus:** $ARGUMENTS

1. **TRIVIAL/SMALL:** no architecture doc. If the change adds a dependency, datastore, external service, or public interface, record a one-line decision (or an ADR if irreversible) in `decisions.md` and stop.
2. **Design:** spawn `architect` with `requirements.md` (+ `ux.md`, `research.md` entries) and the existing-system notes from intake → `docs/engineering/architecture.md` + ADRs.
   - Competing approaches on a decision that is expensive to reverse (LARGE/CRITICAL only): spawn 2 architects in parallel with different optimization briefs (e.g. "simplest operable" vs "scale-ready"), each returning a ≤1-page option instead of writing files; choose or merge, then have one architect write the docs.
3. **Threat model** (any risk flag, or MEDIUM+ handling user data, auth, or external input): spawn `security-engineer` in THREAT MODEL mode on architecture.md → `docs/engineering/security.md`. Its mitigations must become requirements (NFR/AC) or plan tasks.
4. **Gate G3 check:** components and boundaries, interfaces and contracts, data model, authN/Z, failure modes, deployment, observability, rollback are defined. Every infrastructure component traces to a requirement; nothing speculative.
5. **Gate G4 check:** every HIGH/CRITICAL threat has a mitigation or an explicitly accepted risk. Accepting a HIGH+ risk is a human decision.
6. **Irreversible decisions** (datastore, cloud/vendor, paid service, public API shape, data model of record) → human gate: ADR summary, options, recommendation.
7. Update status.md and decisions.md.
