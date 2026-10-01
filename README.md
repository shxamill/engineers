# engineers — Engineering OS for Claude Code

A reusable **Autonomous Engineering Operating System** packaged as a Claude Code plugin. Tell it "Build me a production-ready SaaS for X", "Add authentication", or "Fix this production bug". A CTO orchestrator classifies the request, routes it to the minimum capable team from a capability registry, and drives it through discovery → requirements → design → architecture → threat model → plan → build → verify → review → release → outcome → learning, with evidence at every gate.

## Install into a project
```
/plugin marketplace add shxamill/engineers
/plugin install engineering-os@engineers
/engineering-os:eng-init
/engineering-os:eng Build me a production-ready SaaS for invoicing
```
Requires Claude Code 2.1+ and Node.js 18+ (Windows, macOS, Linux). Full manual: [plugins/engineering-os/README.md](plugins/engineering-os/README.md).

## Repository layout
| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace listing the plugin |
| `plugins/engineering-os/` | The plugin: agents, skills, hooks, routing registry, engines, templates, evals |
| `docs/engineering/` | The OS's own engineering state: V2 audit, research, ADRs, decisions, retrospectives, benchmark results |
| `.claude/settings.json` | Dogfoods the plugin from this directory |

## Verify the OS
```
node plugins/engineering-os/scripts/validate-org.mjs
node plugins/engineering-os/scripts/verify-hooks.mjs
node plugins/engineering-os/scripts/test-engines.mjs
claude plugin validate plugins/engineering-os
```
CI runs the first three on Ubuntu and Windows.
