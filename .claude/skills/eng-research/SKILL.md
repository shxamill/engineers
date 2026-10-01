---
name: eng-research
description: Targeted research when a decision depends on facts we don't have (APIs, libraries, versions, standards, domain, competitors). Deduplicates against research.md and runs parallel researcher agents for independent questions.
argument-hint: <questions or topic> [quick|standard|deep]
---
# Research

**Topic:** $ARGUMENTS

1. **Name the decision(s)** this research must support. If you can't name one, don't research.
2. **Reuse first:** grep `docs/engineering/research.md` for the topic. If a current finding exists, use it and stop.
3. **Split** into independent questions (≤4), each with depth: `quick` (1–3 sources), `standard` (cross-checked), `deep` (systematic sweep).
4. **Execute:**
   - A trivial lookup (one doc page, one version check): do it yourself with WebSearch/WebFetch.
   - One substantial question: spawn one `researcher`; it appends its R-entry to research.md.
   - Several independent questions: spawn one `researcher` per question **in a single message**, telling each to *return* its R-entry rather than write the file (avoids concurrent edits). Append the entries yourself.
5. **Synthesize:** conclusion → evidence → confidence → implication for the decision. Flag conflicts between sources and anything anecdotal.
6. Record the decision the research enabled in `decisions.md` if it is durable.

Never fabricate sources, versions, or benchmarks. "Unknown" is a valid finding.
