---
name: eng-intake
description: Classify a request (TRIVIAL/SMALL/MEDIUM/LARGE/CRITICAL), frame the problem, flag risks and human decision gates, and record it in status.md. First step of /eng; also usable standalone to size a request.
argument-hint: <request>
---
# Intake (Gate G0)

**Request:** $ARGUMENTS

1. **Inspect only what sizing needs:** status.md Now (already in context), repository shape (`git ls-files | head -50`, manifests such as package.json/pyproject), and the area the request touches (Grep/Glob, or `Explore` for an unfamiliar codebase).
2. **Write the intake block** (≤15 lines, kept in your context):
   ```
   Problem:      <what is wrong or missing, for whom>
   Users:        <who>
   Outcome:      <observable success>
   Scope:        <in>
   Non-goals:    <out>
   Constraints:  <stack, time, budget, platform, compliance>
   Existing:     <relevant current system, or "greenfield">
   Dependencies: <external services, teams, data>
   Risk flags:   <auth | payments | PII | secrets | prod-data | infra | external-input | new-dependency | irreversible | none>
   Unknowns:     <item — impact low/high>
   Class:        <TRIVIAL..CRITICAL> because <reason>
   ```
3. **Class = max(size, risk).** Any risk flag → security gate mandatory. prod-data, infra, or irreversible → a human gate before that action.
4. **Unknowns.** High-impact unknowns that change product behavior or architecture → ask now (one AskUserQuestion, ≤3 questions, each with a recommended option). Low-impact → assume and record.
5. **New product or substantial feature (MEDIUM+):** write `docs/engineering/product.md` working backwards (user, problem, most important benefit, evidence they want it, the experience, success metric, non-goals), ≤1 page, or delegate it to product-manager together with the spec.
6. **Record** in `docs/engineering/status.md` → Now: objective, class, risk flags, phase = intake done, next phase. Add assumptions under Assumptions.

Don't produce documents for TRIVIAL/SMALL work beyond the status line.
