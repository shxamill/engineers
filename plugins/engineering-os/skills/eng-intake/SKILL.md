---
name: eng-intake
description: "F0: classify a request by scope and risk, route it to the minimum team via the capability registry, and trigger discovery when needed."
argument-hint: <request>
---
# Intake (F0) and discovery trigger (F1)

**Request:** $ARGUMENTS

1. **Inspect only what sizing needs:** the status snapshot (in context), the project profile (`docs/engineering/project-profile.json`), and the area the request touches (Grep/Glob; the `Explore` agent only for an unfamiliar codebase).
2. **Score risk.** Rate each dimension low|medium|high|critical; risk = the highest:
   blast radius · reversibility · data sensitivity · external exposure · production impact · dependency uncertainty · architectural uncertainty · security sensitivity · operational criticality.
   Flags (registry `risk_requirements`): auth, payments, pii, secrets, prod-data, infra, external-input, new-dependency, ai, ui, irreversible.
3. **Score scope:** trivial (one obvious change) · small (≤~3 files, one component) · medium (a feature across components) · large (new product or subsystem).
4. **Route:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-route.mjs" --request "<summary>" --scope <s> --risk <r> --flags <f,...>`
5. **Intake block** (≤15 lines, keep in context; copy the key lines to status.md Now):
   ```
   Problem / Users / Outcome (observable) / Scope / Non-goals / Constraints / Existing system
   Risk: <level> (<driving dimensions>) · Flags: <…> · Class: <router CLASS>
   Unknowns: <item — impact low|high>
   Staffing: <router STAFF + REVIEWERS>, or "main session only"
   ```
6. **Discovery (F1)** for new products or unclear requests (skip for known bugs and small changes): write `docs/engineering/product.md` from `${CLAUDE_PLUGIN_ROOT}/templates/product.md`, a PR/FAQ-style brief covering target user, problem, current alternatives, assumptions vs evidence, success metric, non-goals, minimum useful version. When uncertainty is high, validate before building: the smallest experiment, prototype, or human question that resolves it.
7. **Unknowns:** high-impact ones that change product behavior or architecture → ask now (one AskUserQuestion, ≤3 questions, each with a recommended option). Low-impact → assume and record.
8. **Record** in status.md → Now: objective, class, risk, flags, phase, next phase.
