# engineers — Engineering OS source repository

This repo is the **source of the `engineering-os` Claude Code plugin** (`plugins/engineering-os/`) and its marketplace (`.claude-plugin/marketplace.json`). It also dogfoods the plugin through `.claude/settings.json`. The plugin's universal rules live in `plugins/engineering-os/constitution.md` (injected by hooks), not here.

## Where things go
- Role behavior → `plugins/engineering-os/agents/` · workflows → `skills/eng-*` · file-type standards → `skills/standards-*` (`paths:`) · staffing → `routing/capabilities.yaml` · deterministic logic → `scripts/` or `hooks/scripts/` · templates → `templates/`.
- OS project state (audit, research, ADRs, decisions, retros) → `docs/engineering/`.
- Never copy OS internals into product repos; they install the plugin.

## Before committing any plugin change
```
node plugins/engineering-os/scripts/validate-org.mjs
node plugins/engineering-os/scripts/verify-hooks.mjs
node plugins/engineering-os/scripts/test-engines.mjs
claude plugin validate plugins/engineering-os
```
Behavior changes also need an eval case in `plugins/engineering-os/evals/` and a `PROC-n` row in `docs/engineering/decisions.md`. Verify Claude Code mechanics against current docs or the installed CLI; never invent configuration fields.
