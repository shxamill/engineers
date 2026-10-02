# Research Log
Reusable findings only. Confidence: **V** = primary source fetched · **S** = secondary or search summary · **M** = background knowledge, not re-verified this session. Re-verify S/M items before citing them as requirements.

V3 research (2026-10-02, CLI 2.1.287) continues in [`v3-research.md`](v3-research.md); where the two disagree, the V3 entry is newer.

## R-CC: Claude Code platform (2026-10-01, CLI 2.1.286)
| # | SOURCE | KEY FINDING | IMPLICATION FOR OUR ENGINEERING OS | Conf |
|---|---|---|---|---|
| 1 | code.claude.com/docs/en/plugins-reference; `claude plugin init` scaffold | Plugin = `.claude-plugin/plugin.json` (only `name` required) + `agents/`, `skills/`, `hooks/hooks.json`, `bin/`, `.mcp.json`…; `${CLAUDE_PLUGIN_ROOT}` substituted in hooks and in skill/agent bodies | Package the OS as a plugin; call scripts via `${CLAUDE_PLUGIN_ROOT}` in skill text (not exported to the Bash tool) | V |
| 2 | plugins-reference | Plugins cannot ship CLAUDE.md, `.claude/rules`, permissions, or sandbox (plugin settings accept only `agent`, `subagentStatusLine`) | Constitution via SessionStart/SubagentStart `additionalContext`; rules → conditional skills; permissions/sandbox written by `/eng-init` into project settings | V |
| 3 | sub-agents docs; binary | Plugin agents are `plugin:agent`; they ignore `hooks`, `mcpServers`, `permissionMode`; subagents may spawn subagents (default depth 3, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); concurrency cap 20 | Namespace-aware hooks; per-agent hooks move to plugin hooks.json; deny `Agent` to workers so only the orchestrator staffs | V |
| 4 | binary (`[skills] Activated conditional skill`) | Skills with `paths:` are conditional and activate when matching files are touched | Path rules ship as `standards-*` skills | V |
| 5 | plugin-marketplaces docs | `marketplace.json` (`name`, `owner`, `plugins[]`); relative source `./plugins/x`; `claude plugin validate`; `--plugin-dir` for ad-hoc loading | Repo = marketplace; plugin in `plugins/engineering-os/` | V |
| 6 | `claude plugin eval --help`; binary schema | Native eval runner: `evals/**/case.yaml` with `scaffold_script`, `max_turns`, `runs`, graders `regex` (last_message / files), `file_exists`, `llm`, `tool_used` (min/max), `tool_order`, `baseline`; ablation vs no-plugin; `--max-cost-usd` | Benchmark suite = native eval cases; `tool_used max` measures over-delegation | V |
| 7 | sandboxing docs; binary | Docs: sandbox on macOS/Linux/WSL2, native Windows unsupported; keys `sandbox.enabled`, `failIfUnavailable`, `filesystem.*`, `network.allowedDomains`, credential `files`/`envVars` deny/mask. Binary 2.1.286 also contains native-Windows sandbox install/ACL code (possibly gated) | Recommend sandbox via `/eng-init`; on Windows prefer WSL2, else confirm with `/sandbox`; hooks remain defense in depth | V (docs) / conflict |
| 8 | agent-teams docs | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; 3–5 teammates; higher cost; one team per session; no `--print`; teammates ignore subagent `skills` | Teams off by default; opt-in for LARGE work with genuinely independent streams | V |
| 9 | hooks docs; empirical (askexp) | `permissionDecision` allow/deny/ask/defer; `ask` not auto-approved by bypass mode, refused headless; exec form avoids shells; SubagentStart `additionalContext` (≤10k chars) | Keep `ask` approvals; inject a compact constitution into every org subagent | V |
| 10 | tools-reference | Task tools default on listed models, may be opt-in on newer ones; lists persist in `~/.claude/tasks/` | Use Task tools when present; durable task state stays in implementation-plan.md | V |
| 11 | sandboxing (re-checked 2026-10-01) | "runs on macOS, Linux, and WSL2. Native Windows is not supported"; enforced for every Bash, PowerShell, or Monitor command and its child processes; Linux/WSL2 need `bubblewrap` + `socat` | Supersedes the R-CC-7 conflict for documentation: tell Windows users to use WSL2 for the sandbox | V |
| 12 | permissions | "Permission rules are enforced by Claude Code, not by the model"; Read/Edit deny rules cover file tools, recognized Bash file commands and redirections, but not arbitrary subprocesses ("For OS-level enforcement… enable the sandbox") | Security docs: deny rules + sandbox are the boundary; hooks are an extra text-level layer | V |
| 13 | plugins/components | No `CLAUDE.md` loaded from a plugin root (`claude plugin validate` warns); plugin `settings.json` honors only `agent` and `subagentStatusLine`; plugin agents ignore `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` | Confirms R-CC-2/3 | V |
| 14 | plugins/install; CLI 2.1.287 (empirical) | In a session `/plugin install x@m` opens a review panel to pick a scope; shell `claude plugin install x@m --scope user\|project\|local`; project scope writes `extraKnownMarketplaces` + `enabledPlugins` to `.claude/settings.json` and each collaborator still installs once; `owner/repo#ref` pins a ref; third-party marketplaces don't auto-update; cloud sessions (claude.ai/code) don't load locally installed or repo-enabled plugins. Verified: `claude plugin marketplace add shxamill/engineers` + install succeed | Exact install/update commands for the README; cloud-session limitation | V |
| 15 | agent-teams | Experimental, off by default; when enabled, a subagent Claude names launches as a teammate; teammates don't apply an agent definition's `skills`; start with 3–5 teammates | Teams stay opt-in; warn that enabling them changes ordinary delegation | V |
| 16 | plugin-evals | "A single run is noisy… confirm any change at the default three runs"; `file_exists` counts only files created during the run; Bash runs under the OS sandbox | Report benchmark results as single-run, Sonnet-only; plan a 3-run baseline | V |
| 17 | skills; sub-agents | Skill descriptions are always in context, bodies load on invoke; `paths` limits activation; `context: fork` runs in a subagent (background by default, `background: false` waits); subagents have their own context window, nest to depth 3; `isolation: worktree` branches from the default branch | Token-economy claims in the README are platform-backed | V |

## R-DOC: Documentation practice (2026-10-01)
| # | SOURCE | KEY FINDING | IMPLICATION | Conf |
|---|---|---|---|---|
| 1 | docs.github.com "About READMEs" | A README says what the project does, why it's useful, how to start, where to get help, who maintains it; GitHub generates an outline from headings; relative links follow the viewed branch; content past 500 KiB is truncated | Root README answers what/why/start/help; relative links only | V |
| 2 | diataxis.fr | Tutorials, how-to guides, reference, and explanation serve different needs and should stay separate | Root README = explanation + quick start; plugin README = reference + how-to | V |
| 3 | docs.github.com "Creating diagrams" | Mermaid renders in Markdown files from ```mermaid blocks | Architecture diagrams in Mermaid, syntax-checked before commit | V |
| 4 | READMEs of hashicorp/terraform, kubernetes/kubernetes | One-sentence definition first; README is a hub that links to depth | Progressive disclosure; deep material in linked docs | V |
| 5 | README of cloudflare/workerd | States plainly what the project is not ("not a hardened sandbox") and lists design principles | Explicit "what this is not" and security caveats | V |
| 6 | README of SWE-agent/SWE-agent | Benchmark numbers with links to the underlying detail and caveats | Report each benchmark run exactly, link the run files, never aggregate runs | V |

## R-AG: Agentic engineering practice
| # | SOURCE | KEY FINDING | IMPLICATION | Conf |
|---|---|---|---|---|
| 1 | code.claude.com/docs/en/best-practices | A runnable check is the biggest lever; hooks are deterministic, CLAUDE.md advisory; a long CLAUDE.md gets ignored; reviewers told to "find gaps" over-report | Stop-hook verification gate; tiny constitution; reviewer rubric = correctness + stated requirements | V |
| 2 | anthropic.com/engineering/multi-agent-research-system (2025) | Multi-agent ≈15× chat tokens; most coding tasks aren't parallelizable enough | Default to one owner + independent reviewer; fan out only for independent work | V |
| 3 | anthropic.com/engineering/effective-context-engineering-for-ai-agents (2025) | Context rot; just-in-time retrieval via paths; condensed subagent summaries | Paths over content; compact handoffs; durable state files | V |
| 4 | engineering.atspotify.com …/feedback-loops-background-coding-agents-part-3 (Dec 2025) | Verifiers auto-activate from repo contents and run via stop hook; an LLM judge vetoes ~25% of sessions (mostly unrequested refactors), ~half self-correct; narrow tool surface | Project adapter auto-discovers verifiers; scope judge after deterministic gates | V |
| 5 | stripe.dev/blog/minions… (2026) | Deterministic "blueprint" steps interleaved with agent steps; fast local lint (<5s) before CI; ≤2 CI rounds | Deterministic verifier; retry budget ≤2 per approach | V |
| 6 | metr.org reward-hacking (Jun 2025) | Frontier models modify tests or evaluators to pass | Test-tamper detection in the verifier; reviewer flags test/CI diffs | V (rates S) |
| 7 | metr.org Time Horizon 1.1 (Jan 2026); METR RCT (Jul 2025) | 50%-success horizons are hours, not production reliability; self-reported speedups are unreliable | Small verifiable tasks; measure outcomes, not feelings | V |
| 8 | SWE-bench Pro aggregators | Verified is saturated; Pro scores inconsistent across sources | Don't choose models by leaderboard; use our own evals | S |
| 9 | Airbnb test migration (2025); Google arXiv 2504.09691 | Validate-then-retry loops with caps beat prompt tuning; ~2× gains with humans in the loop | Bounded retries feeding back verifier errors | S / V |

## R-ORG: Engineering organization and secure SDLC
| # | SOURCE | KEY FINDING | IMPLICATION | Conf |
|---|---|---|---|---|
| 1 | Amazon Working Backwards (PR/FAQ) | Customer problem and FAQ before building | `product.md` is a PR/FAQ-style brief for new products | M |
| 2 | AWS Operational Readiness Reviews | Pre-launch checklist grown from past incidents | Release-readiness template; postmortem lessons feed it | M |
| 3 | google.github.io/eng-practices | Approve when code health improves, not perfection; small CLs | Reviewer rubric; small vertical tasks | M |
| 4 | GitLab product development flow | Validation track precedes build track | F1 discovery is separate from F7 build; poor outcome → back to discovery | M |
| 5 | DORA 2025 (dora.dev; Google PDF) | Five metrics incl. new rework rate; AI raises throughput and instability | Outcome measurement includes change-fail and rework; volume isn't success | S |
| 6 | Google SRE books | SLOs and error budgets; blameless postmortems; canaries | Staged rollout + rollback triggers; postmortem template | M |
| 7 | teamtopologies.com | Stream-aligned teams supported by enabling/platform teams; minimize cognitive load | Value-delivery cell + on-demand specialists + platform capabilities | M |
| 8 | NIST SP 800-218 v1.1 (+800-218A; Rev.1 draft Dec 2025) | PO/PS/PW/RV practice groups | Map lifecycle gates to SSDF groups (ADR-0002) | V |
| 9 | OWASP ASVS 5.0.0 (May 2025) | ~350 requirements, 17 chapters, L1–L3 | Security ACs cite ASVS IDs; L1 default, L2 for sensitive features | S |
| 10 | Threat Modeling Manifesto + STRIDE | Four questions; STRIDE per trust boundary | Threat model template structure | M |
| 11 | SLSA v1.2 (Nov 2025); OpenSSF Scorecard | Build L0–3, new Source track; Scorecard posture | Pinned actions, provenance when releasing artifacts | S |
| 12 | docs.github.com Actions secure-use | SHA pinning, read-only GITHUB_TOKEN, no untrusted checkout under `pull_request_target`, env-var indirection, OIDC | infra standards skill checklist | V |
