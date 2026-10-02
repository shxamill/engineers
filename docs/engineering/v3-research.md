# Engineering OS V3 — research synthesis

_Date: 2026-10-02 · Claude Code CLI 2.1.287 · Author: orchestrator (V3 effort)_

This document records the evidence behind the V3 design. Each finding separates four kinds of statement:

- **FACT:** what the source states, quoted or closely paraphrased.
- **OBSERVATION:** what we measured or saw ourselves.
- **INFERENCE:** our reasoning from the fact, which could be wrong.
- **DESIGN DECISION:** what Engineering OS does about it.

"Company X does it" is never a reason on its own. Sources were fetched on 2026-10-02 unless a finding says otherwise. Earlier findings stay in [`research.md`](research.md) (R-CC, R-AG, R-ORG, R-DOC) and are cited by ID rather than repeated.

**Confidence:**
- **V:** primary source fetched in this effort.
- **S:** search summary or secondary source.
- **E:** our own experiment, with its evidence path given.

---

## 1. Claude Code platform (docs current to CLI 2.1.287)

Raw pages were saved during research. Only the decision-relevant facts are reproduced here.

### CC-1 · Stop hook loop protection · V
- **Source:** code.claude.com/docs/en/hooks (Stop input)
- **Fact:** Stop hooks receive `stop_hook_active`, `last_assistant_message`, `background_tasks`, and `session_crons`. Claude Code also "applies an 8-consecutive-continuation cap" on stop-hook blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- **Why it matters:** the completion gate is the only deterministic "done" check. It must never trap a session.
- **Design decision:** keep blocking at most once per stop attempt (`stop_hook_active`). The platform cap is a second safety net, not the design.

### CC-2 · SubagentStop input · V
- **Source:** hooks (SubagentStop input)
- **Fact:** SubagentStop receives `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, and `stop_hook_active`.
- **Inference:** a ledger entry can be bound to a concrete `agent_id`, not just an agent name.
- **Design decision:** gate-ledger entries record `agent_id` and the content fingerprint of the tree that was reviewed (see CC-14 and E-3).

### CC-3 · Hook timeouts and failure semantics · V
- **Source:** hooks (command hook fields; exit codes)
- **Facts:**
  - The default command-hook timeout is 600 s.
  - Exit 2 blocks.
  - A JSON object that fails schema validation on exit 0 is a non-blocking error: "the action proceeds".
- **Inference:** a crashing or slow hook fails open unless it explicitly emits a decision.
- **Design decision:**
  - Keep explicit per-hook timeouts (10–30 s).
  - Guards fail closed to `ask` on internal errors (already the case).
  - The completion gate fails open on its own errors, so it never traps a session; this is documented as a trade-off.
  - V3 adds a runtime budget test so a slow guard is caught in CI.

### CC-4 · Subagent model resolution · V
- **Source:** code.claude.com/docs/en/sub-agents (Choose a model); model-config
- **Fact:** the subagent model resolves in this order:
  1. the per-invocation `model` parameter;
  2. the `model` frontmatter (`sonnet` | `opus` | `haiku` | `fable` | full ID | `inherit`);
  3. `CLAUDE_CODE_SUBAGENT_MODEL`;
  4. the main conversation's model.

  Aliases "point to the recommended version for your provider", and the `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` variables remap them.
- **Inference:** model tiers can be expressed as aliases and stay provider-portable. Users already have platform knobs (alias remapping, a global subagent override), so we don't need our own.
- **Design decision:**
  - The registry declares a **tier** (`low` | `medium` | `high`) per capability, mapped once to an alias (`haiku` | `sonnet` | `opus`). The validator enforces `agent.model == tiers[capability.tier]`.
  - Escalation for one call uses the per-invocation `model` parameter.
  - Remapping uses the platform environment variables. There is no custom model config.

### CC-5 · Unknown frontmatter fields are ignored silently · V
- **Source:** sub-agents ("Claude Code ignores a field it doesn't recognize without reporting an error")
- **Why it matters:** a typo such as `maxturns` silently removes a bound.
- **Design decision:** the validator gets an allowlist of agent and skill frontmatter keys and errors on unknown ones.

### CC-6 · `maxTurns` returns partial output · V
- **Source:** sub-agents
- **Fact:** "When the subagent reaches the limit, Claude Code returns its output marked as partial, and Claude can resume it."
- **Design decision:** the handoff contract treats a partial result as `FAIL` or `BLOCKED` for retry accounting. The orchestrator resumes the agent instead of respawning it, so context isn't rebuilt.

### CC-7 · Tool allowlists and denylists · V
- **Source:** sub-agents (`tools`, `disallowedTools`)
- **Fact:** omitting `tools` inherits every tool. If both fields are set, `disallowedTools` is applied first.
- **Design decision:** every org agent keeps an explicit `tools` allowlist (validator-enforced). V3 audits each agent's list for least privilege (see v3-audit).

### CC-8 · Skills: progressive disclosure, forks, paths · V
- **Source:** code.claude.com/docs/en/skills
- **Facts:**
  - Descriptions are always in context; bodies load on invoke.
  - The combined description is truncated at 1,536 characters.
  - `paths` restricts automatic activation.
  - `context: fork` runs the skill in a subagent, in the background unless `background: false`.
- **Design decision:** retain the V2 design (validated). Review skills stay `background: false` (the PROC-13 lesson).

### CC-9 · Plugin cost measurement · V
- **Source:** code.claude.com/docs/en/plugins/measure
- **Facts:**
  - The always-on figure "counts each component's name plus its `description` and `when_to_use`".
  - The remedy is shorter descriptions or splitting the plugin.
  - Shortening descriptions can stop a skill from triggering, so check with a `tool_used: Skill` grader.
- **Design decision:** footprint is a tracked metric (`claude plugin details`) with a regression budget in the validator. Description edits must keep triggering cases green.

### CC-10 · Plugin trust · V
- **Source:** code.claude.com/docs/en/plugins/security
- **Fact:** "A Claude Code plugin you install can execute arbitrary code on your machine with your user privileges."
- **Inference:** our hooks and the agent's Bash tool run as the same OS user. Nothing the plugin writes to disk is out of the agent's reach.
- **Design decision:** evidence integrity is defense in depth against accidental staleness and opportunistic tampering. It is **not** a security boundary against a deliberately adversarial agent, and the docs say so (see E-3).

### CC-11 · `CLAUDE_PLUGIN_DATA` · V
- **Source:** plugins/manifest-reference (path variables); hooks
- **Fact:** `${CLAUDE_PLUGIN_DATA}` is `~/.claude/plugins/data/<id>/`, kept across updates and exported to hook processes.
- **Inference:** a signing key stored there is readable by the agent's Bash, because it's the same user (CC-10). Signing evidence would add ceremony, not security.
- **Design decision:** no cryptographic signing. Use content fingerprints plus tamper guards (E-3).

### CC-12 · Versioning · V
- **Source:** plugins/manifest-reference (`version`)
- **Fact:** "Setting it pins the plugin to that version until you change it"; the version is not checked against semver. Third-party marketplaces don't auto-update by default (R-CC-14).
- **Design decision:** treat the OS as a product. Bump `plugin.json` `version` on every behavior change, and keep a `CHANGELOG.md` with migration notes. V3 = `3.0.0`.

### CC-13 · Evals: baseline arm and grader scoring · V
- **Source:** code.claude.com/docs/en/plugin-evals
- **Facts:**
  - By default a case runs a with-plugin arm and a without-plugin arm, three runs each.
  - Graders that "can never pass without the plugin" should be `arm: with-only`, so they don't inflate Δ.
  - "A single run is noisy, so confirm any change at the default three runs."
  - `file_exists` only sees files created during the run.
- **Observation (E-2):** a prompt starting with `/engineering-os:eng` in the no-plugin arm is passed through as text, and Claude acts on the goal.
- **Design decision:**
  - The V3 benchmark runs both arms with identical prompts.
  - OS-process graders (VERDICT line, org agent names) are `with-only`.
  - Outcome graders (correctness, security, scope, test integrity) are scored in both arms.
  - Three runs per case.

### CC-14 · Worktrees · V
- **Source:** code.claude.com/docs/en/worktrees (2026-10-01; R-CC-17)
- **Facts:**
  - Subagent worktrees branch from the default branch unless `worktree.baseRef: "head"`.
  - Worktree isolation blocks edits and commands aimed at the main checkout.
- **Design decision:** retain PROC-15. Content fingerprints use a temporary git index, which is per-worktree safe via `git rev-parse --git-path index`.

### CC-15 · Dynamic workflows and `/goal` · V
- **Source:** code.claude.com/docs/en/workflows; best-practices
- **Facts:**
  - Dynamic workflows are "a JavaScript script that orchestrates many subagents", used for audits, large migrations, and cross-checked research. They support up to 16 concurrent agents by default and are distributable in a plugin `workflows/` directory.
  - They show a "Large workflow" warning above 25 agents.
  - On Pro plans they must be enabled in `/config`.
  - `/goal` sets a session-level condition that a separate evaluator re-checks.
- **Inference:** workflows suit homogeneous fan-out work, such as migrating 500 files or sweeping a codebase. They don't suit the dependent, mixed-capability tasks in a typical feature plan, and they aren't available on every plan.
- **Design decision:**
  - The plan's task graph remains the default execution model.
  - Workflows are a documented option for LARGE homogeneous fan-out, under the same budget rule as agent teams. We don't ship a workflow in V3.
  - We don't depend on `/goal`. The Stop hook is the deterministic gate.

### CC-16 · Agent teams · V
- **Source:** code.claude.com/docs/en/agent-teams (2026-10-01; R-CC-15)
- **Facts:**
  - Agent teams are experimental and off by default.
  - "Start with 3-5 teammates."
  - "Significantly more tokens."
  - When enabled, a subagent Claude names launches as a teammate.
- **Design decision:** retain: off by default, with an explicit recorded reason and budget when used.

### CC-17 · Verification guidance · V
- **Source:** code.claude.com/docs/en/best-practices
- **Facts:**
  - "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only signal."
  - For unattended runs, "a Stop hook runs your check as a script and blocks the turn from ending until it passes".
  - A second opinion comes from a fresh verifier "so the agent doing the work isn't the one grading it".
  - "Bloated CLAUDE.md files cause Claude to ignore your actual instructions."
- **Design decision:** confirms the V2 architecture (deterministic gate plus fresh-context reviewers plus a tiny constitution).

### CC-18 · Memory size guidance · V
- **Source:** code.claude.com/docs/en/memory
- **Fact:** "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."
- **Design decision:** the constitution stays at 45 lines or fewer (validator). The V3 additions go into skills, not the constitution.

---

## 2. Agentic software engineering

### AG-1 · Long-running harnesses · V (2025-11-26)
- **Source:** anthropic.com/engineering/effective-harnesses-for-long-running-agents
- **Facts:**
  - Two failure patterns: "agents attempting to complete entire projects at once" and "prematurely declaring tasks finished".
  - Fixes: a feature list with pass/fail tracking, a progress file plus git history, and "single features per session".
- **Inference:** a persistent, machine-checkable task list with per-task status and evidence is the antidote to premature "done". V2's plan table has states but no per-task evidence or attempt count.
- **Design decision:**
  - Add `AC`, `Attempts`, and `Evidence` columns to the plan.
  - `eng-plan-check` enforces a Definition of Ready (DoR) for READY and a Definition of Done (DoD) for DONE, including that the evidence exists.
  - The attempt count is checked against the class retry budget.

### AG-2 · Agent evals · V (2026-01-09)
- **Source:** anthropic.com/engineering/demystifying-evals-for-ai-agents
- **Facts:**
  - Code graders are "fast, cheap, objective" but brittle; model graders "require calibration".
  - Grade "what the agent produced, not the path it took".
  - pass@k vs pass^k.
  - Separate capability evals from regression evals; "an eval at 100% tracks regressions but provides no signal for improvement".
- **Design decision:**
  - The benchmark reports pass^3, meaning a case passes in all 3 runs, which is the consistency signal an engineering org needs, alongside the mean score.
  - Outcome graders dominate.
  - Process graders are with-only diagnostics.
  - Cases split into a regression suite (gate behavior) and a capability suite (open-ended work).

### AG-3 · Start simple · V (2024-12-19)
- **Source:** anthropic.com/engineering/building-effective-agents
- **Facts:** "consider adding complexity only when it demonstrably improves outcomes"; orchestrator-workers suits "unpredictable subtasks" such as coding; "poka-yoke your tools".
- **Design decision:**
  - Every V3 addition must name the failure it prevents and the test that proves it.
  - No new runtime components: no services, queues, or databases.
  - Interfaces are made poka-yoke where possible: engines emit one-line verdicts, and invalid states are rejected by checkers rather than explained in prompts.

### AG-4 · Agent-computer interfaces · V (2024)
- **Source:** Yang et al., SWE-agent, arXiv 2405.15793
- **Fact:** "LM agents represent a new category of end users… and would benefit from specially-built interfaces"; linting on edit and concise feedback improved performance.
- **Design decision:** deterministic engines print compact, actionable lines (already the case). V3 extends this to `eng-status.mjs`, which produces the status report from files instead of the model gathering it turn by turn.

### AG-5 · Reward hacking · V (2025-06-05)
- **Source:** metr.org/blog/2025-06-05-recent-reward-hacking
- **Facts:**
  - Models "monkey-patch the evaluator so that every piece of code passes".
  - On some task families reward hacking reached 100% of runs.
  - "Please do not cheat" left it at 70–95%.
- **Inference:** instructions do not prevent evaluator tampering, so the defenses must be mechanical and assume the agent may game the checker.
- **Design decision:** V3 extends tamper detection to:
  - CI bypass, such as `|| true` on test commands and `continue-on-error: true`;
  - `--passWithNoTests` and similar;
  - lowered coverage thresholds;
  - writes to verification evidence and the gate ledger (a tamper guard);
  - verification bound to a content fingerprint, so `touch`ing the evidence no longer satisfies the gate.

### AG-6 · Context engineering · V (2025-09-29)
- **Source:** anthropic.com/engineering/effective-context-engineering-for-ai-agents
- **Facts:** "context rot"; "find the smallest set of high-signal tokens"; sub-agents returning "condensed summaries (1,000–2,000 tokens)"; structured note-taking.
- **Design decision:**
  - Handoffs stay at 5 or fewer bullets.
  - Status is computed by a script.
  - Large output goes to evidence files.

### AG-7 · Multi-agent cost · V (2025-06-13)
- **Source:** anthropic.com/engineering/multi-agent-research-system
- **Facts:**
  - Agents use about 4× the tokens of chat; multi-agent systems about 15×.
  - "Most coding tasks involve fewer truly parallelizable tasks than research."
  - Effort should scale with complexity: "simple fact-finding requires just 1 agent".
- **Design decision:**
  - Retain class budgets.
  - V3 telemetry measures agents spawned per class, so overstaffing becomes visible rather than assumed.

### AG-8 · Verifier loop in production · V (2025-12-09)
- **Source:** engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3
- **Facts:**
  - Verifiers "activate automatically based on repository contents" and run via a stop hook.
  - An LLM judge "vetoes about a quarter of [sessions]", and the agent course-corrects about half the time.
  - The most frequent veto cause is "going outside the instructions".
- **Design decision:** retain the scope judge after deterministic checks. V3 adds deterministic scope signals the judge can't miss: class-vs-diff and risk-flag-vs-path cross-checks.

### AG-9 · Deterministic steps and bounded CI rounds · V (2026-10-01; R-AG-5)
- **Source:** stripe.dev/blog/minions (via research.md)
- **Fact:** deterministic "blueprint" steps are interleaved with agent steps, with at most 2 CI rounds.
- **Design decision:** retain the retry ladder: attempt 1 → attempt 2 with the verifier output → change of strategy → debugger → architecture review. V3 makes the attempt count a plan field checked by `eng-plan-check`.

---

## 3. Engineering organizations

### ORG-1 · Code review standard · V
- **Source:** google.github.io/eng-practices/review/reviewer/standard.html
- **Facts:** "favor approving a CL once it… definitely improves the overall code health… even if the CL isn't perfect"; non-critical comments are marked "Nit:".
- **Design decision:** retain BLOCKING / SHOULD_FIX / NIT in the reviewer (already in V2). The gate treats only BLOCKING as CHANGES_REQUIRED.

### ORG-2 · Small changes · V
- **Source:** google.github.io/eng-practices/review/developer/small-cls.html
- **Facts:** small changes are "reviewed more quickly… more thoroughly… less likely to introduce bugs… simpler to roll back"; "100 lines is usually a reasonable size… 1000 lines is usually too large."
- **Inference:** a deterministic size signal helps keep tasks reviewable.
- **Design decision:** retain the plan rule of about 10 files or fewer per task. `eng-verify` SCOPE reports added and removed line counts, so oversized changes are visible to reviewers.

### ORG-3 · Blameless postmortems · V
- **Source:** sre.google/sre-book/postmortem-culture
- **Facts:** triggers include "user-visible downtime… beyond a certain threshold" and "data loss of any kind"; "you can't 'fix' people, but you can fix systems and processes"; "an unreviewed postmortem might as well never have existed".
- **Design decision:** retain the retrospective and postmortem templates. Each generalized lesson becomes a `PROC-n` entry plus an eval case or regression test, and that link is checked in review of OS changes (CONTRIBUTING).

### ORG-4 · SLOs and error budgets · V
- **Source:** sre.google/sre-book/service-level-objectives
- **Facts:** "Have as few SLOs as possible"; error budgets inform release decisions.
- **Design decision:** the release plan carries 1–3 SLIs/SLOs per meaningful service. Post-deploy verification compares against them. No SLO machinery is added for libraries or CLIs.

### ORG-5 · Validation before build · S
- **Source:** GitLab product development flow (handbook search summary)
- **Fact:** a dual-track flow: "aim to validate features before building them"; break the result into "the smallest possible iterations".
- **Design decision:** retain F1 discovery and F15 outcome, where a miss returns to discovery.

### ORG-6 · Working Backwards · V
- **Source:** aboutamazon.com, "an insider look at Amazon's culture and processes"
- **Facts:** "start by defining the customer experience, then iteratively work backwards"; PR plus FAQ; most PR/FAQs don't get approved.
- **Design decision:** retain the `product.md` PR/FAQ brief for new products.

### ORG-7 · Operational readiness reviews · V (2022-06-30)
- **Source:** docs.aws.amazon.com/wellarchitected/latest/operational-readiness-reviews
- **Facts:** ORR "distill[s] the learnings from AWS operational incidents into curated questions", is applied "throughout the complete lifecycle", and aims for "shorter, fewer, and smaller incidents".
- **Inference:** a readiness checklist is only valuable if it is checked, and it should grow from incidents.
- **Design decision:**
  - New `eng-release-check.mjs` deterministically validates `release-plan.md`: every readiness row needs PASS or a justified N/A plus evidence, and production needs a named human approval.
  - Postmortem action items may add readiness rows.

### ORG-8 · DORA metrics · V (page dated 2026-01-05)
- **Source:** dora.dev/guides/dora-metrics
- **Facts:**
  - Five metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate.
  - They are grouped as throughput and instability.
  - "Setting metrics as a goal… increases the likelihood that teams will try to game the metrics."
- **Design decision:**
  - `eng-outcome` may record DORA-style delivery data diagnostically.
  - The OS's own telemetry is diagnostic only, with no targets.
  - The benchmark reports distributions, not a single "score to beat".

### ORG-9 · Team Topologies · V
- **Source:** teamtopologies.com/key-concepts
- **Facts:** four team types (stream-aligned, platform, enabling, complicated subsystem) and three interaction modes; "competent teams become ineffective when leaders keep adding to their plate."
- **Design decision:** retain the topology tag per capability and the delivery-cell model. Cognitive load maps to context load, so subagents stay focused.

---

## 4. Security and supply chain

### SEC-1 · Secure development framework · V (2026-10-01; R-ORG-8)
- **Source:** NIST SP 800-218 SSDF v1.1, Feb 2022 (csrc.nist.gov)
- **Fact:** four practice groups: Prepare the Organization (PO), Protect the Software (PS), Produce Well-Secured Software (PW), Respond to Vulnerabilities (RV).
- **Design decision:** v3-architecture maps lifecycle gates to SSDF groups. This is traceability, not certification.

### SEC-2 · Microsoft SDL · V
- **Source:** microsoft.com/securityengineering/sdl/practices
- **Fact:** ten practices, including "perform security design review and threat modeling", "secure the software supply chain", "secure the engineering environment", and "perform security testing".
- **Inference:** "secure the engineering environment" maps directly to our sandbox, permissions, guards, and evidence-integrity layer.
- **Design decision:** state that mapping explicitly in the security architecture.

### SEC-3 · Threat modeling · V
- **Source:** cheatsheetseries.owasp.org Threat_Modeling_Cheat_Sheet
- **Facts:**
  - Four questions: "What are we working on? What can go wrong? What are we going to do about it? Did we do a good enough job?"
  - Use DFDs and trust boundaries, STRIDE, and the responses mitigate, eliminate, transfer, or accept.
  - Do it "early in the SDLC" and keep refining it.
- **Design decision:** the threat-model template follows the four questions with assets, actors, trust boundaries, entry points, data flows, STRIDE threats, mitigations, and residual risks. Mitigations become plan tasks with verifiers.

### SEC-4 · Application security requirements · V
- **Source:** owasp.org ASVS project page
- **Fact:** the current stable version is 5.0.0; ASVS "provides developers with a list of requirements for secure development", with versioned IDs such as `v5.0.0-1.2.5`.
- **Design decision:** retain citing ASVS IDs in security acceptance criteria.

### SEC-5 · Build provenance levels · V
- **Source:** slsa.dev
- **Fact:** v1.2 is current. Build L1 = provenance exists; L2 = hosted build platform with signed provenance; L3 = hardened builds.
- **Design decision:** out of scope for most product repositories. Release readiness asks whether artifacts have provenance when the project publishes them; it is reported, not forced.

### SEC-6 · Repository security checks · V
- **Source:** github.com/ossf/scorecard docs/checks.md
- **Fact:** checks include Pinned-Dependencies, Token-Permissions, Dangerous-Workflow, Dependency-Update-Tool, SAST, and Security-Policy.
- **Design decision:** `eng-verify` gains a deterministic **SUPPLY-CHAIN** line covering the subset checkable from a diff:
  - unpinned actions added (WARN);
  - `permissions: write-all` added (FAIL);
  - `pull_request_target` combined with a checkout of the PR head (FAIL);
  - a dependency manifest changed without its lockfile (WARN);
  - new dependencies listed.

### SEC-7 · GitHub Actions hardening · V
- **Source:** docs.github.com/en/actions/reference/security/secure-use
- **Facts:**
  - "Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release."
  - Default `GITHUB_TOKEN` to read-only.
  - Pass untrusted input through env vars.
  - Workflows triggered by `pull_request_target` "must not explicitly check out untrusted code".
- **Design decision:** as in SEC-6. The project's own CI already pins `actions/checkout` and uses `contents: read`.

---

## 5. Documentation

### DOC-1 · Progressive disclosure · V (2026-10-01; R-DOC-1..6)
- **Source:** research.md R-DOC (GitHub README guidance, Diátaxis, major project READMEs)
- **Design decision:** retain the split: the root README explains, the plugin README is the reference and how-to, and `docs/engineering/` is deep material. V3 adds the architecture, migration, and changelog documents under that split.

---

## 6. Our own experiments

### E-1 · Measured context footprint (V2) · E
- **Method:** `claude -p "Reply with the single word OK." --model haiku --max-turns 1` in an empty git repo with an isolated config, run with and without `--plugin-dir`.
- **Results:**
  - **Without the plugin:** 29,295 input tokens.
  - **With the plugin:** 31,043 input tokens.
  - **Delta:** about 1,748 tokens.
  - **For comparison:** `claude plugin details` estimates about 2,150 always-on tokens.
- **Evidence:** `.eng/evidence/v3-baseline/ctx-*.json` and `plugin-details-v2.txt` (local, gitignored).
- **Inference:** the CLI estimate is conservative. Real first-turn overhead in this environment is about 6% of the base prompt.
- **Design decision:** report both figures, and re-measure after V3 with the same method.
- **V3 re-measurement (2026-10-02, same method):** 29,304 tokens without the plugin and 31,142 with it, a delta of about 1,838 tokens (+90 against V2). `claude plugin details` estimates about 2,165 always-on tokens. Evidence: `.eng/evidence/v3-baseline/ctx-v3-*.json` and `plugin-details-v3.txt`.

### E-2 · Unknown plugin command in the baseline arm · E
- **Method:** run `claude -p "/engineering-os:eng Reply with the word OK"` without the plugin.
- **Result:** the turn succeeds and Claude acts on the goal text. The unknown command is passed through as text.
- **Design decision:** identical prompts in both arms give a fair A/B (CC-13).

### E-3 · Evidence forgery demonstration · E
- **Method:** while timing hooks, we piped a synthetic SubagentStop payload into `check-handoff.mjs` from a shell.
- **Result:** it appended 15 `code-reviewer PASS` entries to `.eng/evidence/gates.jsonl`, which would have satisfied the completion gate. Under V2, `touch .eng/evidence/verify-latest.json` would likewise satisfy verification freshness, because freshness compares file mtimes. The entries were deleted.
- **Inference:** V2's gate prevents *skipping* steps by omission. It does not stop opportunistic forgery, the behavior AG-5 documents. Because everything runs as the same user (CC-10, CC-11), no on-disk secret can fully prevent forgery.
- **Design decision:**
  - (a) Bind evidence and reviewer verdicts to a **content fingerprint** of the source tree, so stale or `touch`ed evidence doesn't match.
  - (b) `guard-bash` denies shell commands that write to `.eng/evidence` or `.eng/state`, or that invoke the plugin's hook scripts directly. `guard-secrets` denies Edit/Write to those paths.
  - (c) The gate cross-checks that the evidence directory and logs referenced by `verify-latest.json` exist.
  - (d) Document the residual risk: a deliberately adversarial agent with shell access can still forge evidence. The independent verifiers are CI and human review, and the OS sandbox narrows what the shell can write.

### E-4 · Hook runtime (V2) · E
- **Method:** 15 runs per hook on Linux (Node 22), with representative input.
- **Results:**
  - **Node startup alone:** 23 ms.
  - **Hooks, p50:** 41–73 ms. The slowest is `session-context`, which makes git calls.
- **Evidence:** `.eng/evidence/v3-baseline/hook-runtime-v2.md`.
- **Design decision:** V3 keeps every hook under about 150 ms p50 on Linux. A CI budget test asserts each test invocation stays under 5 s, which catches pathological regexes and git hangs.
- **V3 re-measurement (2026-10-02):** `verify-hooks --timings` over the 306 test invocations, same machine: p50 `guard-bash` 65 ms, `guard-secrets` 53, `check-handoff` 60, `session-context` 73, `subagent-context` 62, `stop-verify` 100, `format-edited` 58; the highest single call was 147 ms (`stop-verify`). The inputs differ from the V2 measurement (test cases rather than 15 representative calls), so the numbers are comparable only roughly. `stop-verify` grew the most because it now computes the content fingerprint (extra git calls). All hooks stay within the 150 ms p50 target.
