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
- [ADR-0002](docs/engineering/adr/0002-engineering-os-v2.md), for the architecture;
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

**After pushing,** confirm that the `org-ci` workflow is green on **both** Ubuntu and Windows (PROC-14). Windows checks out files with CRLF line endings. To reproduce that on Linux or macOS:

```bash
printf '[core]\n\tautocrlf = true\n' > /tmp/gitconfig-crlf
GIT_CONFIG_GLOBAL=/tmp/gitconfig-crlf node plugins/engineering-os/scripts/test-engines.mjs
```

## Tests travel with behavior

- **Hook changes** need cases in `scripts/verify-hooks.mjs`. Cover both directions: what must be blocked or asked, and what must still be allowed. Read-only and everyday commands must stay unblocked.
- **Engine changes** need cases in `scripts/test-engines.mjs`.
- **New gates get a mutation check.** Disable the new condition, confirm the suite fails, then restore it.
- **Never delete, skip, or weaken a test** to get green. If a test is wrong, fix it and say why in the commit message.
- **Behavior changes need an eval case.** A change to what the orchestrator or an agent does needs a case in `plugins/engineering-os/evals/` that would have caught the problem, plus a `PROC-n` row in [`decisions.md`](docs/engineering/decisions.md).

## Benchmark expectations

- Run the affected cases with `claude plugin eval . --case "<NN-name>" --scaffold --trust-plugin --allow-tools Bash Write Edit --ablation none --no-publish` from `plugins/engineering-os/`. `--case` takes a single glob, so use one invocation per case. `--keep-temp` keeps the workspace for inspection.
- Publish full-suite results in `docs/engineering/benchmarks/` using `scripts/bench-summary.mjs`, with a failure analysis that separates OS defects from grader bugs.
- **Report each run exactly as it ran.** Never combine separate runs into one score, and never present a projection as a measurement. Say how many runs per case, which model, and which Claude Code version.

## Rules for hooks

Hooks run on every user's machine with their privileges, so:
- **Use exec form only:** `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/<name>.mjs"]`. There is no shell, so it works on Windows. The validator enforces this.
- **No dependencies.** Use Node built-ins only, and keep compatibility with Node 18.
- **Guards only `deny` or `ask`; they never `allow`.** Something a guard can't analyze becomes `ask`. Reserve `deny` for catastrophic, never-legitimate commands.
- **The completion gate blocks once per stop attempt** (`stop_hook_active`) **and fails open on its own errors.** A gate that crashes must not trap a session.
- **Keep the parsing PowerShell-aware** where commands are analyzed, and keep the existing timeouts.
- Hooks are defense in depth. Don't describe them as a sandbox anywhere.

## Agents, skills, and the registry

- An agent's `tools`, `model`, and `maxTurns` must match its capability entries in `capabilities.yaml`.
- No agent gets the `Agent` tool.
- Plugin agents can't use `hooks`, `mcpServers`, or `permissionMode`; Claude Code ignores them.
- Descriptions are always in context: keep them at 200 characters or fewer, and quote any YAML value that contains `": "`.
- A skill's `name` equals its directory. Standards skills need `paths:` and `user-invocable: false`. Forked review skills use `context: fork`, `agent: engineering-os:<agent>`, and `background: false`.
- `validate-org.mjs` checks all of the above. Extend it when you add a new kind of rule.

## Documentation

- Update the [README](README.md) and the [plugin manual](plugins/engineering-os/README.md) in the same change when commands, counts, gates, or limitations change.
- Verify every Claude Code claim against the [official documentation](https://code.claude.com/docs/en/plugins) or the installed CLI. Record platform findings in [`research.md`](docs/engineering/research.md) with a confidence level. Never invent configuration fields.
- Use relative links inside the repository.

## Architectural changes

Propose significant or hard-to-reverse changes as an ADR in [`docs/engineering/adr/`](docs/engineering/adr/), using [`plugins/engineering-os/templates/adr.md`](plugins/engineering-os/templates/adr.md). The next number is `0003`. An ADR states the context, the decision, the alternatives considered, and the consequences. Link it from `decisions.md`.

## Commits and pull requests

- Keep commits small and focused, with messages in the form `<type>(<scope>): <summary>`, for example `fix(os): …`, `test(os): …`, or `docs(eng): …`. Explain why in the body.
- Never force-push or rewrite shared history.
- In the pull request, describe what changed, which checks you ran and their results, and any benchmark impact.

## Reporting problems

Use [GitHub Issues](https://github.com/shxamill/engineers/issues). For a suspected security vulnerability, don't post exploit details publicly; open an issue asking for a private contact.
