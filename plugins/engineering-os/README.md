# Engineering OS plugin: operating manual

This is the reference for installing, configuring, and operating the `engineering-os` Claude Code plugin. For **what Engineering OS is, why it exists, and how well it has been evaluated**, start with the [repository README](../../README.md).

**Contents:** [Install, update, and remove](#install-update-and-remove) · [First run](#first-run-eng-init) · [Working with the orchestrator](#working-with-the-orchestrator) · [Command reference](#command-reference) · [Classes, budgets, and phases](#classes-budgets-and-phases) · [Risk flags](#risk-flags) · [Agents](#agents) · [Engines](#engines) · [Hooks](#hooks) · [Project state](#project-state) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting) · [Benchmark](#running-the-benchmark) · [Changing the plugin](#changing-the-plugin)

## Install, update, and remove

Requirements:
- Claude Code (tested with 2.1.286 and 2.1.287);
- Node.js 18 or newer on `PATH`;
- Git.

The recommended OS sandbox runs on macOS, Linux, and WSL2, but not native Windows.

| Task | In a Claude Code session | From a shell |
|---|---|---|
| Add the marketplace | `/plugin marketplace add shxamill/engineers` | `claude plugin marketplace add shxamill/engineers` |
| Install | `/plugin install engineering-os@engineers` (opens the details panel; pick a scope) | `claude plugin install engineering-os@engineers [--scope user\|project\|local]` |
| Check it loaded | Type `/engineering-os:` and look for the skills | `claude plugin list` · `claude plugin details engineering-os` |
| Update | `/plugin` → **Installed** → **Update now** | `claude plugin marketplace update engineers` then `claude plugin update engineering-os@engineers` |
| Disable or enable | `/plugin` → **Installed** | `claude plugin disable engineering-os@engineers` · `claude plugin enable engineering-os@engineers` |
| Uninstall | `/plugin uninstall` | `claude plugin uninstall engineering-os@engineers` |

**Install scopes.**
- **user:** every project on this machine.
- **project:** everyone working in the repository, through the committed `.claude/settings.json`.
- **local:** just you, in this repository.

A project-scope install writes exactly this to `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "engineers": { "source": { "source": "github", "repo": "shxamill/engineers" } }
  },
  "enabledPlugins": { "engineering-os@engineers": true }
}
```

Committing that file enables the plugin for collaborators, but each of them still runs `claude plugin install engineering-os@engineers --scope project` once.

**Notes.**
- **Updates are manual.** Third-party marketplaces don't auto-update by default, so update explicitly. A running session keeps the version it loaded; `/reload-plugins` or a new session picks up the update.
- **Upgrading from 2.x.** 3.0.0 can block work that 2.x allowed. Read the [migration guide](../../docs/engineering/v3-migration.md) and the [CHANGELOG](CHANGELOG.md).
- **Pinning.** To pin a branch or tag, add `#ref` to the source: `/plugin marketplace add shxamill/engineers#<branch-or-tag>`. No release tags exist yet.
- **Cloud sessions.** Claude Code on the web (claude.ai/code) doesn't load locally installed or repository-enabled plugins.
- **Working on the plugin itself.** Load it from a clone without installing: `claude --plugin-dir plugins/engineering-os`.

## First run: `eng-init`

Run `/engineering-os:eng-init` once per project. It takes five steps:
1. **Detects** the stack and its check commands, offline and deterministically, and writes `docs/engineering/project-profile.json`. Example output:
   ```text
   STACK: javascript · npm · no framework detected
   CHECKS: lint=`npm run lint` · test=`npm run test`
   CI: none · DEPLOY: none · DATA: none · AI: none
   NOTES: no typecheck command detected; no build command detected; no CI configuration detected
   ```
   Detection covers Node.js (npm, pnpm, yarn, bun, including workspaces), Python (uv, poetry, pip), Go, Rust, Java, and .NET, as well as CI, deploy, database, and AI usage.
2. **Creates state:** `docs/engineering/status.md` and `decisions.md`. It also adds `.eng/` to `.gitignore`.
3. **Records a baseline** with `/engineering-os:eng-verify targeted`. A red baseline is recorded as a pre-existing condition, so later work isn't blamed for it.
4. **Offers recommended settings.** Plugins can't ship permissions, sandbox, or worktree settings, so `eng-init` shows [`templates/project-settings.json`](templates/project-settings.json) and asks once: apply all, all except the sandbox, or skip. The block contains:
   - `permissions.deny` rules for `.env` files, private keys, AWS credentials, and `~/.ssh`;
   - `sandbox.enabled` with a package-registry and GitHub domain allowlist;
   - `worktree.baseRef: "head"`, so parallel subagent worktrees start from your current branch.
5. **Reports** the stack, the checks, any gaps (no tests, no typecheck, no CI), the baseline verdict, and which settings were applied.

To correct detection, add entries under `overrides` in `project-profile.json`. Overrides survive re-detection:

```json
{
  "overrides": {
    "checks": [{ "id": "e2e", "kind": "e2e", "cmd": "npx playwright test", "cwd": "." }],
    "disable": ["lint"]
  }
}
```

Check kinds: `build`, `lint`, `format`, `typecheck`, `test`, `integration`, `e2e`, `security`, `secrets`.

## Working with the orchestrator

- **Start:** `/engineering-os:eng <goal>`.
- **Session start:** the `SessionStart` hook injects the constitution plus a snapshot: branch, uncommitted files, worktrees, project profile, and the **Now** section of `status.md`. Work therefore resumes from files, not from chat history. `/engineering-os:eng` continues from `status.md` and the plan's ready frontier rather than restarting.
- **What it asks you.** Only the human-gate decisions:
  - product direction or materially ambiguous behavior;
  - irreversible architecture;
  - production data or infrastructure;
  - paid commitments, secrets, legal or compliance matters;
  - high-risk security actions;
  - external communication.

  It asks once, with up to three questions, each with options and a recommendation. Everything else it decides and records as an assumption in `status.md`.
- **Git:** on the default branch it first creates `eng/<slug>`. It makes focused commits (`<type>(<scope>): <summary> [T-n]`), stages only the files the work changed, and never pushes or opens a pull request unless asked.
- **`status.md` Now** must carry the class, flags, and (for SMALL+) acceptance criteria. The completion gate reads them:
  ```text
  ## Now
  - Objective: Add admin login
  - Class: SMALL · Risk: high · Flags: auth, secrets, external-input
  - Waived: ui (the login form reuses the existing, already reviewed form component)
  - AC-1: POST /admin/login with the configured password returns a session cookie
  - AC-2: a wrong or missing password returns 401 and sets no cookie
  - Phase: F9 review
  ```
  `Waived: <flag> (<reason>)` answers a flag that the changed paths imply but that doesn't apply. `Skipped: <gate> (<reason>)` records a deliberate skip of `acceptance_criteria` or `plan_complete`.
- **Final report:**
  - outcome and what changed;
  - an acceptance table (`Criterion | met? | evidence`, including one row per risk-flag deliverable);
  - a gate table (`Phase | required? | evidence`);
  - the `eng-verify` summary lines;
  - open risks and assumptions;
  - the next step.

## Command reference

All commands are `/engineering-os:<name>`. Paths are relative to the project root.

| Command | Arguments | Phase | Produces |
|---|---|---|---|
| `eng` | `<goal or request>` | F0–F16 | Drives everything below as the class requires; final report |
| `eng-init` | none | setup | `docs/engineering/project-profile.json`, `status.md`, `decisions.md`; optional `.claude/settings.json` merge |
| `eng-intake` | `<request>` | F0–F1 | Class, flags, and staffing in `status.md`; `product.md` brief for new or unclear products |
| `eng-research` | `<questions or topic> [quick\|standard\|deep]` | F1 | Sourced, deduplicated entries in `research.md` |
| `eng-spec` | `[feature or scope]` | F2–F3 | `requirements.md` (acceptance criteria and verification methods), `ux.md` |
| `eng-arch` | `[focus]` | F4–F5 | `architecture.md`, `adr/NNNN-slug.md`, threat model in `security.md` |
| `eng-plan` | `[scope]` | F6 | `implementation-plan.md` task graph, validated by `eng-plan-check` |
| `eng-build` | `[T-ids \| next-wave]` | F7–F8 | Code and tests, one commit per task, plan states updated |
| `eng-judge` | `[T-id \| base-ref]` | F9 | Scope judge verdict in a fresh context: PASS or CHANGES_REQUIRED |
| `eng-review` | `[base-ref \| commit-range \| T-id]` | F9 | Code review verdict in a fresh context |
| `eng-test` | `[scope]` | F9 / F11 | `test-plan.md`, missing tests, adversarial QA for LARGE or flagged work |
| `eng-secreview` | `[base-ref \| commit-range \| T-id]` | F10 | Security review verdict in a fresh context; findings in `security.md` |
| `eng-verify` | `[targeted\|standard\|full] [--only kinds] [--base ref] [--task T-id] [--network]` | F11 | Compact verdict; logs and a schema-2 `summary.json` in `.eng/evidence/verify-<ts>/`, plus `verify-latest.json` |
| `eng-debug` | `<symptom, failing command, or error>` | any | Root cause, minimal fix, regression test; postmortem for incidents |
| `eng-release` | `[environment] [version]` | F12–F14 | `release-plan.md` checked by `eng-release-check` (READY / NOT_READY), gated deploy, evidence in `.eng/evidence/release-<version>/` |
| `eng-outcome` | `[feature or FR id]` | F15 | A row in `outcomes.md`: ACHIEVED, PARTIAL, NOT_YET, MISSED, or UNMEASURABLE |
| `eng-status` | `[--metrics]` | any | The deterministic report from `eng-status.mjs` (class, tasks, agents, verification, reviews, open gates, next action); `--metrics` adds telemetry counters |
| `eng-retro` | `[initiative or incident]` | F16 | `retrospectives/NNNN-slug.md`, `PROC-n` rows in `decisions.md` |

(All produced documents live under `docs/engineering/` unless the path says otherwise.)

`eng-judge`, `eng-review`, and `eng-secreview` run in a forked subagent (`context: fork`, `background: false`), so the reviewer never sees the author's conversation. The six `standards-*` skills (backend, data, frontend, infra, security-sensitive, testing) are not commands. They activate when matching files are touched and are preloaded into the agents that need them.

## Classes, budgets, and phases

Class budgets come from [`routing/capabilities.yaml`](routing/capabilities.yaml):

| Class | Max subagents | Concurrency | Research | Retries per approach | Verify level | Required reviewers | Diff ceiling |
|---|---|---|---|---|---|---|---|
| TRIVIAL | 0 | 0 | none | 1 | targeted | none (self-check of the diff) | 1 non-test source file, 1 area |
| SMALL | 1 | 1 | none | 2 | standard | code-review | 3 non-test source files, 1 area |
| MEDIUM | 4 | 2 | quick | 2 | standard | scope-judge, code-review | — |
| LARGE | 8 | 4 | standard | 2 | full | scope-judge, code-review, adversarial-qa | — |
| CRITICAL | 10 | 3 | standard | 2 | full | scope-judge, code-review, appsec, adversarial-qa | — |

How the class is chosen:
- Risk is the highest of the nine intake dimensions, passed as `eng-route --dims blast-radius=low,security-sensitivity=high,…`. A `--risk` below that is rejected.
- Scope sets the class. Critical risk means CRITICAL, and high risk is never TRIVIAL.
- A new user-facing interface (CLI, endpoint, page), or more than 3 expected files, makes the work at least MEDIUM.
- Between two classes, choose the higher.
- The completion gate rejects a declared class whose diff exceeds the ceiling, and TRIVIAL work that carries a risk flag.

Lifecycle gates by class (registry `gates`, enforced by the completion gate): **acceptance criteria** for SMALL and above, a **complete plan** (no task READY, RUNNING, REVIEW, or VERIFICATION) for MEDIUM and above.

Which phases run for each class:

| Phase | TRIVIAL | SMALL | MEDIUM | LARGE | CRITICAL |
|---|---|---|---|---|---|
| F0 Intake | inline | inline | ✓ | ✓ | ✓ |
| F1 Discovery and research | – | if unknowns | if unknowns | ✓ | ✓ |
| F2 Requirements | – | criteria in `status.md` | ✓ | ✓ | ✓ |
| F3 UX design | – | – | if UI | if UI | if UI |
| F4 Architecture | – | decision line | light | ✓ + ADRs | ✓ + ADRs |
| F5 Threat model | – | if flagged | if flagged | ✓ | ✓ |
| F6 Plan (task graph) | – | – | ✓ | ✓ | ✓ |
| F7–F8 Build and integrate | direct | direct or 1 agent | eng-build | eng-build (worktrees) | eng-build |
| F9 Independent review | self-check | code review | scope judge + code review | + adversarial QA | + adversarial QA |
| F10 Security review | – | if flagged | if flagged | if flagged | ✓ |
| F11 Verification | targeted | standard | standard | full | full |
| F12–F14 Release | only when deploying | | | | staged rollout |
| F15 Outcome | – | – | if a success signal exists | ✓ | ✓ |
| F16 Retrospective | – | – | if surprises | ✓ | ✓ |

Order inside F9–F11: deterministic verification first, then the scope judge, then the code reviewer, then the security reviewer. Fix and re-verify between them.

## Risk flags

| Flag | Required capabilities | Evidence the final report must show |
|---|---|---|
| `auth` | threat-modeling, appsec | Threat model; constant-time secret comparison; unguessable tokens; tests rejecting unauthenticated and wrong-credential requests |
| `payments` | threat-modeling, appsec, privacy | Threat model; idempotency; amounts in integer minor units; tests for failure and retry paths |
| `pii` | privacy, appsec | Data inventory; minimization; access-control tests; no PII in logs |
| `secrets` | appsec | Secrets only from the environment or a secret store; none in code, logs, fixtures, or commits |
| `prod-data` | database, release | Migration plan with rollback; verified backup; recorded human approval |
| `infra` | platform-engineering, appsec | Plan or diff of the change; least privilege; rollback path |
| `external-input` | appsec | Validation at the boundary; size limits; tests for malformed input |
| `new-dependency` | supply-chain | Justification; license; maintenance and advisory check; pinned version |
| `ai` | ai-ml | Labeled eval set (typical, edge, adversarial including prompt injection) with a measured score; output validated against an allowlist; unit tests mock the model |
| `ui` | ux | Loading, empty, error, and success states; keyboard and screen-reader access; how it was checked |
| `irreversible` | architecture | ADR with alternatives; recorded human approval |

AppSec, privacy, and supply-chain are gate reviewers (`reviewer_gate: true` in the registry), so the completion gate waits for their PASS. The other capabilities are staffed first when the class allows them; otherwise the router prints them as `UNCOVERED BY BUDGET` and the orchestrator covers them or reports them unmet.

**Flags implied by the diff.** The registry's `risk_paths` maps `auth`, `payments`, `pii`, `secrets`, `prod-data`, `infra`, `ai`, and `ui` to path patterns (for example `src/auth/`, `billing`, `migrations/`, `.github/workflows/`, `*.tsx`); `eng-verify` detects `new-dependency` from manifest diffs. The completion gate requires every implied flag to be declared in `Flags:` or waived with a reason.

## Agents

All agents are namespaced `engineering-os:<name>` and get the constitution injected at start. None has the `Agent` tool, so only the orchestrator staffs.

| Agent | Model (registry tier) | Max turns | Edits files | Capabilities |
|---|---|---|---|---|
| `product-manager` | sonnet (medium) | 30 | docs | product-management, product-analytics |
| `researcher` | sonnet (medium) | 30 | docs | product-research |
| `ux-designer` | sonnet (medium) | 30 | docs | ux, ui-visual, design-systems |
| `architect` | opus (high) | 40 | docs | architecture |
| `frontend-engineer` | sonnet (medium) | 60 | yes | frontend, mobile |
| `backend-engineer` | sonnet (medium) | 60 | yes | backend, database, integrations |
| `ai-engineer` | sonnet (medium) | 60 | yes | ai-ml |
| `platform-engineer` | sonnet (medium) | 50 | yes | devops, platform-engineering, release |
| `reliability-engineer` | sonnet (medium) | 50 | yes | sre, performance |
| `test-engineer` | sonnet (medium) | 50 | yes | qa, test-automation |
| `debugger` | opus (high) | 60 | yes | debugging |
| `code-reviewer` | opus (high) | 40 | **no** (Read, Grep, Glob, Bash, PowerShell) | code-review |
| `scope-judge` | sonnet (medium) | 15 | **no** | scope-judge |
| `adversarial-qa` | sonnet (medium) | 40 | **no** | adversarial-qa |
| `security-engineer` | opus (high) | 50 | docs (threat models, reviews) | appsec, threat-modeling, security-testing, privacy, supply-chain |
| `tech-writer` | haiku (low) | 25 | docs | documentation, developer-experience |

"Docs" means the agent has Edit and Write tools and is instructed to write documents, not features. Reviewers that keep Bash can run checks, so "no" is enforced through tool lists and instructions, not by a sandbox. The validator fails if an agent's tools, turn limit, or model drifts from its registry entry; the model must equal the registry's tier map (`low` → haiku, `medium` → sonnet, `high` → opus).

## Engines

Deterministic Node.js scripts with no dependencies. Skills call them as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"`; you can run them from a clone the same way.

| Script | Usage | Output and exit code |
|---|---|---|
| `eng-route.mjs` | `--request "<summary>" --scope trivial\|small\|medium\|large (--dims name=level,… \| --risk low\|medium\|high\|critical) [--flags f1,f2] [--json] [--no-log]` | CLASS and RISK (with the driving dimensions), BUDGET, STAFF (mandatory first), REVIEWERS with their skills, MANDATORY, UNCOVERED BY BUDGET, one DELIVERABLE line per flag, GATES; logs a `route` telemetry event; exit 2 on bad input, an unknown dimension, or a `--risk` below the dimensions |
| `eng-detect.mjs` | `[projectDir] [--write]` | STACK, CHECKS, CI, DEPLOY, DATA, AI, NOTES; `--write` saves `project-profile.json` (keeping `overrides` and `stopGate: false`) |
| `eng-verify.mjs` | `[projectDir] [targeted\|standard\|full] [--only k1,k2] [--skip k] [--base ref] [--task T-id] [--network] [--timeout ms] [--json]` | Compact verdict lines plus an EVIDENCE path; exit 0 on PASS or NO_CHECKS, 1 on FAIL, 2 on usage error |
| `eng-plan-check.mjs` | `[planPath] [--json]` | Errors (cycles, unknown dependencies, same-wave file overlap, bad states, unknown capabilities, owner ≠ capability agent, READY without AC ids, DONE without an existing evidence path, attempts over the class retry budget while in flight) and `READY NOW`; a V2 table (no AC/Attempts/Evidence columns) passes with a warning; exit 1 on errors |
| `eng-release-check.mjs` | `[planPath] [--stage readiness\|post-deploy] [--target <env>] [--env NAME,…] [--json]` | `RELEASE: READY` or `NOT_READY` with one GAP line each: readiness rows need PASS + evidence or N/A + reason; production needs `Human approval: <who>, <when>`; post-deploy rows need actual values, none failing. `--env` prints PRESENT or MISSING per name and never a value. Exit 0 READY, 1 NOT_READY, 2 usage |
| `eng-status.mjs` | `[projectDir] [--metrics] [--json]` | PROJECT, OBJECTIVE, CLASS, TASKS, AGENTS, BLOCKERS, VERIFICATION, REVIEWS, GATE, SECURITY, RELEASE, OUTCOME, COST, NEXT; `--metrics` aggregates `.eng/telemetry.jsonl` |

`eng-verify` details:
- Statuses: `PASS`, `FAIL`, `NOT_RUN` (never counted as PASS), `NOT_APPLICABLE` (only from `overrides.notApplicable` in the profile, with its reason), and `PRE_EXISTING`: failing checks are re-run at the base commit in a temporary worktree, and failures with no new output lines get this label.
- `TESTS-TAMPER` fails on deleted tests, new `skip`/`only` markers, and CI bypasses (`|| true` or `|| exit 0` on a check command, `continue-on-error: true`, `--passWithNoTests`, a no-op test script); it warns on fewer assertions, changed test config, or a lowered coverage threshold.
- `SUPPLY-CHAIN` fails on `permissions: write-all` and on `pull_request_target` with a PR-head checkout; it warns on unpinned actions and on a manifest changed without its lockfile; it lists new dependencies (npm, pip requirements, Go modules), which imply the `new-dependency` flag.
- The evidence directory holds the logs and a schema-2 `summary.json`: per-check status, command, duration and evidence or reason, the commit, the content fingerprint, and the diff signals. `verify-latest.json` points to it.
- `--network` enables registry audits.

## Hooks

Defined in [`hooks/hooks.json`](hooks/hooks.json). All run as `node <script>`, without a shell, so they work the same on Windows.

| Event | Script | What it does | Can it block? |
|---|---|---|---|
| `SessionStart` | `session-context.mjs` | Injects the constitution and the state snapshot (including the sandbox setting); records the session's starting `HEAD` | No |
| `SubagentStart` (`engineering-os:*`) | `subagent-context.mjs` | Injects the constitution into every org agent; logs a `spawn` event | No |
| `PreToolUse` (Bash, PowerShell) | `guard-bash.mjs` | Lexes and analyzes the command; **deny** for catastrophic commands and for writes to the protected evidence and state paths or direct runs of the gate hooks; **ask** for destructive, irreversible, or secret-exposing ones, and for anything it can't parse | Yes |
| `PreToolUse` (Read, Edit, Write, MultiEdit, NotebookEdit, Grep) | `guard-secrets.mjs` | **Denies** file-tool writes to the protected evidence and state paths; **asks** before touching secret paths or writing credential literals | Yes |
| `PostToolUse` (Edit, Write, MultiEdit) | `format-edited.mjs` | Runs the project's own formatter on the edited file if one is configured | No |
| `SubagentStop` | `check-handoff.mjs` | Rejects an org agent's final message without a handoff, or a PASS without EVIDENCE; records accepted verdicts in `.eng/evidence/gates.jsonl` with the agent id and the content fingerprint | Yes |
| `Stop` | `stop-verify.mjs` | The completion gate (below) | Yes, once per stop attempt |

**Protected paths.** `.eng/state/`, `.eng/telemetry.jsonl`, `.eng/evidence/verify-*`, `verify-latest.json`, and `gates.jsonl` are written only by the engines and hooks. Reading them is allowed; scratch output may go to other files under `.eng/evidence/`.

**Content fingerprint.** Freshness is decided by a hash of the source tree, computed from a temporary copy of the git index (`git add -A` → `write-tree` → `ls-tree`, docs and other non-source paths filtered out). The real index is never touched. Any source edit changes the fingerprint; a commit doesn't; touching a file without changing it doesn't. Evidence written by 2.x has no fingerprint and falls back to the old mtime rule.

**Completion gate** ([`gates.mjs`](hooks/scripts/gates.mjs), shared with `eng-status`). It applies when source files changed this session, whether uncommitted or committed since the session started. It requires all of the following:
1. `verify-latest.json` was written at the current fingerprint, and the `summary.json` it points to agrees with it.
2. `Class:` is recorded in `status.md` Now.
3. The diff fits the class's diff ceiling, and TRIVIAL work carries no risk flag.
4. Every flag implied by the changed paths (`risk_paths`) or by new dependencies is declared in `Flags:` or recorded as `Waived: <flag> (<reason>)`.
5. SMALL+ work has acceptance criteria (`AC-n:` lines in `status.md` or `requirements.md`; template placeholders don't count). MEDIUM+ work has a valid `implementation-plan.md` with no task in flight. Either can be skipped only with `Skipped: <gate> (<reason>)`.
6. Every reviewer required by the class and flags has a PASS in the gate ledger at the current fingerprint, and the latest verdict is PASS, not CHANGES_REQUIRED.

Each stop attempt logs a `gate` telemetry event. Documentation-only changes don't trigger the gate: `docs/`, `.eng/`, `.claude/`, Markdown, images, and lockfiles are ignored. The gate fails open on internal errors.

## Project state

Everything lives in the product repository. Nothing from the OS is copied in.

| Path | Written by | Purpose |
|---|---|---|
| `docs/engineering/status.md` | orchestrator, `eng-status` | Live state: Now (class, flags, phase), phases, active work, checks, risks, assumptions |
| `docs/engineering/project-profile.json` | `eng-detect` (`eng-init`) | Detected stack and checks, `overrides`, `stopGate` |
| `docs/engineering/product.md` | `eng-intake`, `product-manager` | PR/FAQ-style product brief |
| `docs/engineering/requirements.md` | `eng-spec` | Acceptance criteria with verification methods; success metrics |
| `docs/engineering/ux.md` | `eng-spec`, `ux-designer` | Flows, states, accessibility |
| `docs/engineering/architecture.md`, `adr/` | `eng-arch`, `architect` | Actual design and decisions |
| `docs/engineering/security.md` | `eng-arch`, `eng-secreview` | Threat model and security findings |
| `docs/engineering/implementation-plan.md` | `eng-plan`, `eng-build` | Task graph: the runtime task database |
| `docs/engineering/test-plan.md` | `eng-test` | Acceptance-criteria-to-test mapping, layers |
| `docs/engineering/release-plan.md` | `eng-release` | Readiness evidence, environments, rollback |
| `docs/engineering/outcomes.md` | `eng-outcome` | Outcome verdicts with evidence paths |
| `docs/engineering/research.md`, `decisions.md`, `retrospectives/` | several | Durable knowledge |
| `.eng/evidence/` (gitignored) | engines, hooks | Logs, `verify-latest.json`, `verify-<ts>/summary.json`, `gates.jsonl` |
| `.eng/state/`, `.eng/telemetry.jsonl` (gitignored) | hooks, engines | Per-session start HEAD; append-only OS events (`route`, `spawn`, `handoff`, `verify`, `guard`, `gate`) read by `eng-status --metrics` |

Templates for these files are in [`templates/`](templates/).

## Configuration

| Setting | Where | Effect |
|---|---|---|
| `overrides.checks`, `overrides.disable` | `docs/engineering/project-profile.json` | Add or disable verification checks; survive re-detection |
| `overrides.notApplicable` | `docs/engineering/project-profile.json` | `{"typecheck": "plain JS, no types"}` reports that kind as `NOT_APPLICABLE (reason)` instead of `NOT_RUN` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`, `…_SONNET_MODEL`, `…_HAIKU_MODEL`; `CLAUDE_CODE_SUBAGENT_MODEL` | environment | Claude Code's own model controls: remap the tier aliases, or force one model for every subagent |
| `"stopGate": false` | `docs/engineering/project-profile.json` | Turns the completion gate off for this project (not recommended) |
| `permissions.deny`, `sandbox`, `worktree.baseRef` | `.claude/settings.json` | Claude Code's own controls; the recommended block is in [`templates/project-settings.json`](templates/project-settings.json) |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | environment or settings `env` | Enables Claude Code agent teams. Off by default; the OS uses them only for LARGE/CRITICAL work with three or more independent streams. While enabled, a subagent Claude names launches as a teammate, and teammates don't apply an agent's preloaded `skills` |

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `Completion gate: … verification: run /engineering-os:eng-verify` | Source changed after the last verification | Run `/engineering-os:eng-verify`. A FAIL verdict still counts as evidence, but must be reported as FAIL |
| `… classification: record Class: and Flags: …` | `status.md` Now has no class | Record the class and flags (`/engineering-os:eng-intake` does this) |
| `… reclassify: N non-test source file(s) in M area(s) …` | The diff is bigger than the declared class allows | Raise the class in `status.md` and run that class's reviews |
| `… <agent> review (required for …)` or `… returned CHANGES_REQUIRED` | A required reviewer hasn't passed the current code | Run the named review skill; fix findings, then re-review |
| `… verification evidence is inconsistent` | `verify-latest.json` and its `summary.json` disagree | Re-run `/engineering-os:eng-verify`; never edit evidence |
| `… risk flags: the change implies \`auth\` (src/auth/…)` | A changed path matches a flag's `risk_paths`, or a new dependency was found | Add the flag to `Flags:` (adds its reviewers), or `Waived: <flag> (<reason>)` if it doesn't apply |
| `… acceptance criteria: record testable AC-n lines` | SMALL+ work without criteria | Add `AC-n:` lines, or `Skipped: acceptance_criteria (<reason>)` |
| `… plan: … is missing` / `tasks still in flight` | MEDIUM+ work without a finished plan | Run `/engineering-os:eng-plan`, finish or close the tasks, or `Skipped: plan_complete (<reason>)` |
| `guard-bash: … writing Engineering OS evidence/state or running its gate hooks by hand` | A command would write evidence, the ledger, state, or telemetry | Run the engine (`eng-verify`) or let the hook record it; write scratch logs to another file under `.eng/evidence/` |
| `guard-bash: … Needs explicit human approval` | A gated command | Approve it in the permission prompt if you intended it, or ask for a safer alternative. Agents are told never to work around it |
| `Handoff missing` / `STATUS: PASS requires EVIDENCE` | An org agent ended without the handoff format | The agent is asked to re-send; no action needed unless it repeats |
| Skills don't appear after install | Plugin not loaded yet | Run `/reload-plugins` or start a new session; check `claude plugin list` |
| Plugin missing in claude.ai/code | Cloud sessions don't load local or repository plugins | Use a local session (terminal, desktop app, IDE) |
| `/sandbox` shows missing dependencies | Linux or WSL2 without `bubblewrap` and `socat` | Install them (for example `sudo apt-get install bubblewrap socat`); native Windows needs WSL2 |

## Running the benchmark

From this directory, with Claude Code authenticated. It costs API usage; set a cap.

```bash
# Two arms (with the plugin and plain Claude Code), three runs per case (ADR-0004)
claude plugin eval . --scaffold --trust-plugin --allow-tools Bash Write Edit --runs 3 --no-publish --max-cost-usd 60 --json results.json
node scripts/bench-summary.mjs results.json --title "Engineering OS benchmark"
```

- `--scaffold` runs each case's `scaffold.sh` as you, so use it only on cases you trust.
- `--no-publish` keeps the HTML report local; by default the runner publishes it to claude.ai when your account supports that.
- The cases set `runs: 1` so a quick check stays cheap; `--runs 3` measures run-to-run variance, which the eval docs recommend before trusting a change.
- Without `--ablation none`, the runner adds a no-plugin baseline arm with the same prompt. Graders marked `arm: with-only` (process checks such as the `eng-verify` VERDICT line) are reported as indicators, not score; `arm: both` graders and unmarked outcome graders score both arms. `bench-summary` reports each arm separately: mean, pass^k, and cost, plus the delta.
- In the baseline arm, the `/engineering-os:eng` prefix reaches plain Claude Code as ordinary text (research E-2).
- `--case <glob>` accepts **one** glob. Run separate invocations for several cases.
- `--keep-temp` keeps each run's workspace for inspection.
- Shell tools run under Claude Code's OS sandbox; on Linux install `bubblewrap` and `socat`.
- Published results and their analysis: [`docs/engineering/benchmarks/`](../../docs/engineering/benchmarks/).

## Changing the plugin

Change the OS in this repository, never inside product repositories. Validation commands, test and eval expectations, hook rules, and the decision process are in [CONTRIBUTING.md](../../CONTRIBUTING.md).
