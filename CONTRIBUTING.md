# Contributing to Engineering OS

Engineering OS is held to the same rules it enforces on other projects:
- evidence before claims;
- tests travel with behavior;
- small, focused changes;
- every process change is recorded.

This guide explains where changes go and what has to pass before they land.

Before a non-trivial change, read:
- the [README](README.md), for the concepts;
- the [plugin manual](plugins/engineering-os/README.md), for the reference;
- [ADR-0003](docs/engineering/adr/0003-engineering-os-v3.md) and the [V3 architecture](docs/engineering/v3-architecture.md), for the current design (built on [ADR-0002](docs/engineering/adr/0002-engineering-os-v2.md));
- [`decisions.md`](docs/engineering/decisions.md), for the process rules (`PROC-n`) that already exist and why.

## Setup

You need Claude Code, Node.js 18 or newer, and Git. There are no package dependencies to install.

```bash
git clone https://github.com/shxamill/engineers.git
cd engineers
claude --plugin-dir plugins/engineering-os   # load your working copy for one session
```

This repository also dogfoods the plugin. [`.claude/settings.json`](.claude/settings.json) registers the checkout itself as a local marketplace and enables `engineering-os@engineers`.

## Where changes belong

| Change | Location |
|---|---|
| Role behavior | `plugins/engineering-os/agents/<agent>.md` |
| Workflows (lifecycle steps) | `plugins/engineering-os/skills/eng-*/SKILL.md` |
| File-type standards | `plugins/engineering-os/skills/standards-*/SKILL.md` (with `paths:`) |
| Staffing, budgets, risk rules | `plugins/engineering-os/routing/capabilities.yaml` |
| Deterministic logic | `plugins/engineering-os/scripts/` (engines) or `plugins/engineering-os/hooks/scripts/` (hooks) |
| Universal rules | `plugins/engineering-os/constitution.md`: at most 45 lines, because every line costs tokens in every session |
| Document templates, recommended settings | `plugins/engineering-os/templates/` |
| Benchmark scenarios | `plugins/engineering-os/evals/<NN-name>/` |
| This project's own records | `docs/engineering/` |

Never copy OS internals into product repositories; they install the plugin.

## Required checks

Run all of these from the repository root before every commit:

```bash
node plugins/engineering-os/scripts/validate-org.mjs
node plugins/engineering-os/scripts/verify-hooks.mjs
node plugins/engineering-os/scripts/test-engines.mjs
claude plugin validate plugins/engineering-os --strict
claude plugin validate .
```

When you change a hook, an engine, or the registry, also run the mutation check. It takes about two minutes:

```bash
node plugins/engineering-os/scripts/mutation-check.mjs --jobs 4        # all mutations
node plugins/engineering-os/scripts/mutation-check.mjs --only gate-fingerprint
```

**After pushing,** confirm that the `org-ci` workflow is green on **both** Ubuntu and Windows (PROC-14), and that its `robustness` job (autocrlf suites plus the mutation check) passes. Windows checks out files with CRLF line endings. To reproduce that on Linux or macOS:

```bash
printf '[core]\n\tautocrlf = true\n' > /tmp/gitconfig-crlf
GIT_CONFIG_GLOBAL=/tmp/gitconfig-crlf node plugins/engineering-os/scripts/test-engines.mjs
```

## Tests travel with behavior

- **Hook changes** need cases in `scripts/verify-hooks.mjs`. Cover both directions: what must be blocked or asked, and what must still be allowed. Read-only and everyday commands must stay unblocked.
- **Engine changes** need cases in `scripts/test-engines.mjs`.
- **New safety logic gets a mutation.** Add an entry to `MUTATIONS` in [`scripts/mutation-check.mjs`](plugins/engineering-os/scripts/mutation-check.mjs): `[id, file, find, replace, suite, mechanism]`, where `find` matches the guarding line exactly once and `replace` disables it. The run must report the mutation as killed, which requires a failing test (`FAIL <name>`); a crash doesn't count. A surviving mutation means a missing test, not a bad mutation.
- **Never delete, skip, or weaken a test** to get green. If a test is wrong, fix it and say why in the commit message.
- **Behavior changes need an eval case.** A change to what the orchestrator or an agent does needs a case in `plugins/engineering-os/evals/` that would have caught the problem, plus a `PROC-n` row in [`decisions.md`](docs/engineering/decisions.md) that **names its regression test or eval case**.
- **Versioning.** Every behavior change bumps `version` in `plugins/engineering-os/.claude-plugin/plugin.json` and adds an entry to [`CHANGELOG.md`](plugins/engineering-os/CHANGELOG.md). A change that can block work that passed before is a major version, and needs migration notes.

## Benchmark expectations

- Run the affected cases with `claude plugin eval . --case "<NN-name>" --scaffold --trust-plugin --allow-tools Bash Write Edit --ablation none --no-publish` from `plugins/engineering-os/`. `--case` takes a single glob, so use one invocation per case. `--keep-temp` keeps the workspace for inspection.
- A full-suite result follows [ADR-0004](docs/engineering/adr/0004-evaluation-model.md): two arms (with the plugin and plain Claude Code, i.e. without `--ablation none`), `--runs 3`, and a cost cap. Publish it in `docs/engineering/benchmarks/` using `scripts/bench-summary.mjs`, with a failure analysis that separates OS defects, baseline behavior, and grader bugs.
- **Report each run exactly as it ran.** Never combine separate runs into one score, and never present a projection as a measurement. Say how many runs per case, which model, which plugin version, and which Claude Code version, and report each arm's cost.

## Rules for hooks

Hooks run on every user's machine with their privileges, so:
- **Use exec form only:** `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/<name>.mjs"]`. There is no shell, so it works on Windows. The validator enforces this.
- **No dependencies.** Use Node built-ins only, and keep compatibility with Node 18.
- **Guards only `deny` or `ask`; they never `allow`.** Something a guard can't analyze becomes `ask`. Reserve `deny` for catastrophic, never-legitimate commands.
- **The completion gate blocks once per stop attempt** (`stop_hook_active`) **and fails open on its own errors.** A gate that crashes must not trap a session.
- **Keep the parsing PowerShell-aware** where commands are analyzed, and keep the existing timeouts. `verify-hooks` fails any hook call slower than 5 s; `--timings` prints p50 per hook.
- **Evidence is engine-written.** `.eng/evidence/verify-*`, `verify-latest.json`, `gates.jsonl`, `.eng/state/`, and `.eng/telemetry.jsonl` are protected by both guards (`PROTECTED_STATE` in [`lib.mjs`](plugins/engineering-os/hooks/scripts/lib.mjs)). A new evidence file the gate trusts must be added there, with deny tests for shell and file-tool writes.
- **Freshness is by content fingerprint** (`sourceFingerprint` in `lib.mjs`), never by mtime alone. New evidence records the fingerprint it was produced at.
- **Telemetry never records command text, file contents, or secret values**, only event types, agent names, verdicts, and reason categories (`logEvent` in `lib.mjs`).
- Hooks are defense in depth. Don't describe them as a sandbox anywhere.

## Agents, skills, and the registry

- An agent's `tools` and `maxTurns` must match its capability entries in `capabilities.yaml`, and its `model` must equal `tiers[<tier>]` of those entries.
- No agent gets the `Agent` tool.
- Plugin agents can't use `hooks`, `mcpServers`, or `permissionMode`; Claude Code ignores them.
- Descriptions are always in context: keep them at 200 characters or fewer, and quote any YAML value that contains `": "`.
- A skill's `name` equals its directory. Standards skills need `paths:` and `user-invocable: false`. Forked review skills use `context: fork`, `agent: engineering-os:<agent>`, and `background: false`.
- Frontmatter keys are allowlisted (`AGENT_KEYS`, `SKILL_KEYS` in the validator), because Claude Code silently ignores unknown keys. Add a key there only after checking it in the current docs.
- `validate-org.mjs` checks all of the above. Extend it when you add a new kind of rule.

## Recipes

Each recipe ends with the [required checks](#required-checks).

**Add a capability** (a new kind of work the router can staff):
1. Add an entry under `capabilities:` in [`capabilities.yaml`](plugins/engineering-os/routing/capabilities.yaml) with `id`, `agent` (an existing or new agent), `group`, `topology`, `purpose`, `triggers`, `risk_triggers`, `classes`, `inputs`, `outputs`, `tools` and `max_turns` (copied from the agent), `scopes`, `tier`, `parallel`, `depends`, `reviewers`, and `security`. Copy the fields from a neighbouring entry; the validator lists any that are missing.
2. If a risk flag should make it mandatory, add it to that flag's `risk_requirements`.
3. If it is an independent reviewer whose PASS the gate requires, set `reviewer_gate: true` and `skill: <forked skill>`; the skill's `agent:` must be this capability's agent.
4. Add router cases to `test-engines.mjs` (it is staffed when expected, and not otherwise).

**Add an agent:**
1. Create `plugins/engineering-os/agents/<name>.md` with `name`, a description of 200 characters or fewer, `tools` (never `Agent`), `model`, and `maxTurns`.
2. Point at least one capability at it, with matching `tools`, `max_turns`, and a `tier` whose model equals the agent's `model`.
3. The body states the role, its inputs, what it must not do, and the handoff it returns (`STATUS / TASK / RESULT / CHANGED / EVIDENCE / RISKS / FOLLOW_UP`).

**Add a skill:**
1. Create `plugins/engineering-os/skills/<name>/SKILL.md`; `name` equals the directory.
2. Lifecycle skills are invoked by `eng`; add the step there. Review skills fork: `context: fork`, `agent: engineering-os:<agent>`, `background: false`. Standards skills need `paths:` and `user-invocable: false`.
3. Watch the always-on budget the validator prints: every model-invocable description counts toward 5,600 characters.

**Add or change a hook:**
1. Register it in [`hooks/hooks.json`](plugins/engineering-os/hooks/hooks.json) in exec form, and put shared logic in `lib.mjs` or `gates.mjs`.
2. Add allow and deny (or ask) cases to `verify-hooks.mjs`, and a mutation to `mutation-check.mjs` if it enforces anything.
3. Fail open on internal errors for gates, and fail to `ask` for guards.

**Add an eval case:**
1. Create `plugins/engineering-os/evals/<NN-name>/case.yaml` and a `scaffold.sh` that calls `setup_case` (copy an existing one), and add the fixture setup to [`evals/_fixtures/cases.sh`](plugins/engineering-os/evals/_fixtures/cases.sh).
2. Use nested YAML maps (`target:` on its own line); the eval loader rejects inline `{ … }` maps.
3. Grade **outcomes** with unmarked graders, which score both arms. Mark graders that only make sense with the plugin (its VERDICT line, its review agents) `arm: with-only`, and budget graders that apply to plain Claude Code too `arm: both`.
4. Prove the fixture reproduces the problem (the failing test fails, the grader fails on the untouched fixture) before running the case.

## Documentation

- Update the [README](README.md) and the [plugin manual](plugins/engineering-os/README.md) in the same change when commands, counts, gates, or limitations change.
- Verify every Claude Code claim against the [official documentation](https://code.claude.com/docs/en/plugins) or the installed CLI. Record platform findings in [`research.md`](docs/engineering/research.md) with a confidence level. Never invent configuration fields.
- Use relative links inside the repository.

## Architectural changes

Propose significant or hard-to-reverse changes as an ADR in [`docs/engineering/adr/`](docs/engineering/adr/), using [`plugins/engineering-os/templates/adr.md`](plugins/engineering-os/templates/adr.md). The next number is `0005`. An ADR states the context, the decision, the alternatives considered, and the consequences. Link it from `decisions.md`.

## Commits and pull requests

- Keep commits small and focused, with messages in the form `<type>(<scope>): <summary>`, for example `fix(os): …`, `test(os): …`, or `docs(eng): …`. Explain why in the body.
- Never force-push or rewrite shared history.
- In the pull request, describe what changed, which checks you ran and their results, and any benchmark impact.

## Reporting problems

Use [GitHub Issues](https://github.com/shxamill/engineers/issues) for normal defects and work. For a suspected security vulnerability, follow [SECURITY.md](SECURITY.md) instead of posting exploit details publicly.
