# Migrating from Engineering OS 2.x to 3.0.0

_Applies to: product repositories that use the `engineering-os` plugin, and forks that customize its registry. Release notes: [CHANGELOG](../../plugins/engineering-os/CHANGELOG.md). Design: [ADR-0003](adr/0003-engineering-os-v3.md)._

## Summary

3.0.0 is a major version because the completion gate can now block work that 2.0.0 let through. That happens in these cases:
- evidence is out of date with the content, or comes from a partial or lower-level `eng-verify` run;
- a risk flag is implied by the changed paths but not declared;
- acceptance criteria for the current objective are missing;
- a MEDIUM+ plan is missing, empty, or still in flight;
- MEDIUM work with a risk flag lacks an adversarial-QA review;
- work committed this session sits on another branch.

Nothing in a product repository has to be rewritten. V2 status files and plans keep working, and old plan tables get a warning. **2.x evidence and reviewer verdicts don't carry a content fingerprint, so they don't count after the upgrade.** Run `/engineering-os:eng-verify` and the required reviews once on work that was in progress.

## 1. Update the plugin

| Where | Command |
|---|---|
| Inside Claude Code | `/plugin` → **Installed** → `engineering-os` → **Update now**, then `/reload-plugins` or start a new session |
| Terminal | `claude plugin marketplace update engineers` then `claude plugin update engineering-os@engineers` |

Then check that `claude plugin list` shows `engineering-os` at version `3.0.0`.

Hooks, agents, and skills load when a session starts. A session that was open before the update keeps using 2.x until you reload it.

## 2. What can block now, and how to clear it

The completion gate (Stop hook) prints one line per open gate. Every line has a deterministic fix:

| Gate message starts with | Why | Fix |
|---|---|---|
| `verification: run /engineering-os:eng-verify` | The verification evidence doesn't match the current content fingerprint. Either a source file changed after the last run, or the evidence was only touched | Re-run `/engineering-os:eng-verify`. Committing does not invalidate evidence; editing a source file does |
| `verification evidence is inconsistent` | `verify-latest.json` disagrees with the `summary.json` it points to | Re-run `/engineering-os:eng-verify`. Never edit evidence by hand (the guards deny it) |
| `verification: the last eng-verify run was partial` / `… at level targeted; SMALL needs …` | The evidence came from `--only`/`--skip`, or from a lower level than the class requires | Run `/engineering-os:eng-verify` at the level named in the message, without `--only`/`--skip` |
| `work committed this session on feat/x is not in the current branch` | Commits made this session were left on another local branch | Check that branch out and finish its verification and reviews there, merge it, or record `Skipped: branches (<reason>)` |
| `reclassify: TRIVIAL work cannot carry risk flags` | A risky change was declared TRIVIAL | Set `Class: SMALL` or higher in status.md Now |
| `risk flags: the change implies \`auth\` (src/auth/login.js)` | A changed source path matches the registry's `risk_paths` for that flag, or the verifier found a new dependency | Add the flag to `Flags:`, which adds its reviewers. If it really doesn't apply, add `- Waived: auth (login.js only renames a log message)` |
| `acceptance criteria: record testable AC-n lines` | SMALL+ work has no acceptance criteria for the current objective | Add `- AC-1: <testable criterion>` lines to status.md Now. Criteria in `docs/engineering/requirements.md` count when that file changed this session or Now refers to it; ones left there by an earlier objective don't. To skip deliberately: `- Skipped: acceptance_criteria (<reason>)` |
| `plan: docs/engineering/implementation-plan.md is missing` / `has no tasks` | MEDIUM+ work has no plan, or only a header row | Run `/engineering-os:eng-plan`, or `- Skipped: plan_complete (<reason>)` |
| `adversarial-qa review (required for MEDIUM + …)` | MEDIUM work with any risk flag needs adversarial QA (PROC-6, now enforced) | Run `/engineering-os:eng-test` |
| `plan: tasks still in flight (T-3=RUNNING)` | A task is READY, RUNNING, REVIEW, or VERIFICATION | Finish it, or mark it BLOCKED or FAILED and record why |
| `plan: eng-plan-check reports N error(s)` | Owner, DoR, DoD, or retry-budget errors | Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-plan-check.mjs" docs/engineering/implementation-plan.md` and fix what it prints |
| `<agent> review … is stale (content changed since)` | The reviewer's PASS was recorded for different content | Re-run that review skill on the final diff |

**Escape hatch.** The gate blocks once per stop attempt. It also does nothing when `docs/engineering/project-profile.json` sets `"stopGate": false`, or when no source file changed. The top-level `docs/`, `.eng/`, and `.claude/` trees, Markdown and other prose files, images, and LICENSE/CHANGELOG files are never source. Unlike 2.x, `.txt` files (for example `requirements.txt`) and lockfiles now are source, and `docs/` counts as non-source only at the top level.

**Guard denials that are new in 3.0.0.** Shell and Edit/Write access that writes these paths is denied:
- `.eng/state/` and `.eng/telemetry.jsonl`;
- `.eng/evidence/verify-*`, `verify-latest.json`, and `gates.jsonl`.

Running `check-handoff.mjs` or `stop-verify.mjs` directly is denied too; reading, copying, or editing their source is not. Reading all of these paths is allowed, including from python or node. Large scratch output may still go to other paths under `.eng/evidence/`, for example `.eng/evidence/test-run.log`.

**New human prompt.** Writing `docs/engineering/project-profile.json` (with Edit/Write or the shell) asks you first, because it defines what verification runs and can turn the completion gate off. `eng-detect --write` (run by `eng-init`) still updates it without a prompt.

## 3. Update project files (recommended, not required)

| File | 2.x | 3.0.0 | If you don't migrate |
|---|---|---|---|
| `docs/engineering/status.md` → Now | `Class` · `Flags` | Adds `Risk:`, optional `Waived:` / `Skipped:` lines, and `AC-n:` lines ([template](../../plugins/engineering-os/templates/status.md)) | The AC gate fails for SMALL+ until AC lines exist somewhere |
| `docs/engineering/implementation-plan.md` | 10 columns | Adds `AC`, `Attempts`, and `Evidence` (13 columns; [template](../../plugins/engineering-os/templates/implementation-plan.md)) | `eng-plan-check` warns "V2 plan format" and skips DoR/DoD and retry checks |
| `docs/engineering/project-profile.json` | `overrides.checks`, `overrides.disable` | Optional `overrides.notApplicable: {"typecheck": "plain JS, no types"}` | Those kinds show NOT_RUN instead of NOT_APPLICABLE |
| `docs/engineering/release-plan.md` | Readiness checklist | Adds a service-level table (SLI, SLO, rollback trigger); the readiness table, production approval, and post-deploy actuals are checked by `eng-release-check.mjs` ([template](../../plugins/engineering-os/templates/release-plan.md)) | The readiness table is still checked; the service-level table is guidance and is not checked |
| `.eng/evidence/verify-latest.json` | No fingerprint (schema 1) | `schema: 2` with fingerprint, commit, level, `partial`, and per-check status | Treated as stale: run `eng-verify` once |
| `.eng/evidence/gates.jsonl` | `{agent, status, at}` | Adds `agent_id` and `fingerprint`; written only for the plugin's namespaced agents | Old entries don't count: re-run the required reviews once |

`.eng/` should already be in `.gitignore`. `eng-init` adds it, and the new `.eng/telemetry.jsonl` lives there too.

## 4. Registry customizations (forks only)

If you edited `routing/capabilities.yaml`:

| 2.x | 3.0.0 |
|---|---|
| `model: haiku\|sonnet\|opus` per capability | `tier: low\|medium\|high`. The top-level `tiers:` maps tiers to model aliases. The validator checks that `tiers[tier]` equals the agent's frontmatter `model` |
| Reviewer → skill map hard-coded in the Stop hook | `reviewer_gate: true` plus `skill: eng-review\|eng-judge\|eng-test\|eng-secreview` on reviewer capabilities. Budget `reviewers` may name only these |
| — | Top-level `risk_dimensions`, `gates` (class lists per gate), and `risk_paths` (flag → path regex) |
| `version: 1` | `version: 2` |

Run `node plugins/engineering-os/scripts/validate-org.mjs`; it reports every mismatch.

## 5. New commands

| Command | Purpose |
|---|---|
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-route.mjs" --request "<request>" --scope small --dims blast-radius=medium,security-sensitivity=high --flags auth` | Risk from dimensions; staffing, reviewers, gates, and uncovered capabilities |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-status.mjs" [--metrics] [--json]` | Deterministic status report; `/engineering-os:eng-status` runs it |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-release-check.mjs" docs/engineering/release-plan.md --target production --env DATABASE_URL,API_KEY` | Release readiness; env names reported as PRESENT or MISSING only |
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/eng-verify.mjs" . standard --task T-3` | Tags evidence with a plan task |

Contributors also get `node plugins/engineering-os/scripts/mutation-check.mjs [--only id] [--jobs n]`.

## 6. What was preserved, changed, and removed

| Component | Status in 3.0.0 |
|---|---|
| Plugin + marketplace layout, constitution injected by hooks | Preserved |
| 16 agents, 24 skills, 31 capabilities, 7 hook handlers | Preserved (no additions) |
| Class budgets; TRIVIAL spawns nothing; fresh-context forked reviewers | Preserved |
| Bash/PowerShell guard lexer; `ask` for destructive and secret access | Preserved, extended with evidence protection |
| Baseline-aware verification (`PRE_EXISTING`) | Preserved |
| Freshness by mtime | Changed to a content fingerprint (time is used only when no fingerprint can be computed, i.e. outside git) |
| Self-declared risk level | Changed: computed from dimensions; flags checked against paths |
| Handoff `OBJECTIVE:` | Changed to `TASK:` (`OBJECTIVE:` still accepted) |
| `/eng-status` assembled by the model | Changed to a script |
| Hard-coded reviewer map in `stop-verify.mjs` | Removed; read from the registry |
| Capability `model:` field | Removed; replaced by `tier:` |

## 7. Rolling back

No release tags exist yet. To run 2.0.0:
1. Uninstall: `claude plugin uninstall engineering-os@engineers`.
2. Check out commit `7721226` of this repository.
3. Add that checkout as a local marketplace: `claude plugin marketplace add <path-to-checkout>`.
4. Install from it.

3.0.0 adds fields and table columns without renaming any that 2.0.0 reads, so 2.0.0 can read V3 status files, plans, and evidence.
