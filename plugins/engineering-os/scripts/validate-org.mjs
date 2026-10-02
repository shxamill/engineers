#!/usr/bin/env node
// Validates the engineering-os plugin: manifest, marketplace, agents, skills, hooks, capability registry,
// cross-references, and context budgets. Run: node scripts/validate-org.mjs   (exit 1 on errors)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseYaml } from './lib/yaml-lite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '..', '..');
const P = (...p) => join(ROOT, ...p);
const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);
const read = (p) => readFileSync(p, 'utf8');
const ls = (p) => (existsSync(p) ? readdirSync(p) : []);
const json = (p, label) => { try { return JSON.parse(read(p)); } catch (e) { err(label, `invalid JSON: ${e.message}`); return null; } };

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  // Strict YAML forbids ": " inside plain scalars; Claude Code's parser may not be lenient, so require quotes.
  const unsafe = m[1].split('\n').find((l) => /^[\w-]+: (?!["'[]).*: /.test(l));
  if (unsafe) return { data: {}, body: m[2], bad: `quote this value (contains ": "): ${unsafe.slice(0, 60)}` };
  try { return { data: parseYaml(m[1]), body: m[2] }; } catch (e) { return { data: {}, body: m[2], bad: e.message }; }
}
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const NS = 'engineering-os';
const KNOWN_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch',
  'Skill', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'LSP']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_ONLY_AGENTS = new Set(['code-reviewer', 'adversarial-qa', 'scope-judge']);
const PLUGIN_IGNORED = ['hooks', 'mcpServers', 'permissionMode'];
const MODELS = /^(inherit|sonnet|opus|haiku|fable|claude-[\w.-]+)$/;
const CLASSES = ['TRIVIAL', 'SMALL', 'MEDIUM', 'LARGE', 'CRITICAL'];
const DESC_MAX = 200;
// Always-on budget: every model-invocable skill and agent description is in context each turn (research CC-9).
const DESC_BUDGET = 5600;
let descChars = 0;
// Claude Code silently ignores unknown frontmatter keys (research CC-5), so a typo would drop a bound.
const AGENT_KEYS = new Set(['name', 'description', 'tools', 'disallowedTools', 'model', 'maxTurns', 'skills', 'effort', 'isolation', 'color', 'background', 'memory', 'omitClaudeMd', 'initialPrompt', 'experimental', ...PLUGIN_IGNORED]);
const SKILL_KEYS = new Set(['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'paths', 'shell', 'hooks', 'metadata', 'license', 'compatibility']);
const GATE_KEYS = new Set(['acceptance_criteria', 'plan_complete']);

// ---------- manifest + marketplace ----------
const manifest = json(P('.claude-plugin', 'plugin.json'), '.claude-plugin/plugin.json') || {};
if (manifest.name !== NS) err('.claude-plugin/plugin.json', `name must be "${NS}"`);
if (!/^\d+\.\d+\.\d+/.test(manifest.version || '')) err('.claude-plugin/plugin.json', 'version must be semver');
const mpPath = join(REPO, '.claude-plugin', 'marketplace.json');
if (existsSync(mpPath)) {
  const mp = json(mpPath, 'marketplace.json');
  const entry = mp?.plugins?.find((p) => p.name === NS);
  if (!entry) err('marketplace.json', `no entry named ${NS}`);
  else if (typeof entry.source === 'string' && !existsSync(join(REPO, entry.source, '.claude-plugin', 'plugin.json'))) err('marketplace.json', `source ${entry.source} has no plugin manifest`);
}
if (existsSync(P('CLAUDE.md'))) warn('CLAUDE.md', 'plugins do not load a root CLAUDE.md; use constitution.md');

// ---------- agents ----------
const agents = new Map();
for (const f of ls(P('agents')).filter((f) => f.endsWith('.md'))) {
  const file = `agents/${f}`;
  const fm = frontmatter(read(P('agents', f)));
  if (!fm) { err(file, 'missing frontmatter'); continue; }
  if (fm.bad) err(file, `frontmatter: ${fm.bad}`);
  const { data, body } = fm;
  const name = f.slice(0, -3);
  if (data.name !== name) err(file, `name must equal filename "${name}"`);
  for (const k of Object.keys(data)) if (!AGENT_KEYS.has(k)) err(file, `unknown frontmatter key "${k}" (Claude Code ignores it silently)`);
  if (!data.description) err(file, 'description required');
  else if (data.description.length > DESC_MAX) err(file, `description ${data.description.length} chars > ${DESC_MAX}`);
  descChars += String(data.description || '').length;
  if (!MODELS.test(String(data.model || ''))) err(file, `model required and must be a known alias (got "${data.model}")`);
  if (!Number.isInteger(data.maxTurns) || data.maxTurns < 1) err(file, 'maxTurns (positive integer) required: unbounded agents waste context');
  for (const k of PLUGIN_IGNORED) if (data[k] !== undefined) err(file, `"${k}" is ignored for plugin agents; move it to hooks/hooks.json or project settings`);
  const tools = asList(data.tools);
  if (!tools.length) err(file, 'explicit tools list required (least privilege)');
  for (const t of tools) {
    if (t === 'Agent' || t === 'Task') err(file, `"${t}": only the orchestrator staffs; workers must not spawn agents`);
    else if (!KNOWN_TOOLS.has(t) && !t.startsWith('mcp__')) err(file, `unknown tool "${t}"`);
  }
  if (READ_ONLY_AGENTS.has(name) && tools.some((t) => WRITE_TOOLS.has(t))) err(file, 'read-only agent must not have write tools');
  for (const s of asList(data.skills)) if (!existsSync(P('skills', s.replace(`${NS}:`, ''), 'SKILL.md'))) err(file, `preloaded skill "${s}" does not exist`);
  if (!/Handoff/.test(body)) err(file, 'body must require the Handoff');
  if (/CLAUDE\.md/.test(body)) err(file, 'references CLAUDE.md, which plugins do not ship');
  agents.set(name, { ...data, tools });
}

// ---------- skills ----------
const skills = new Map();
for (const d of ls(P('skills'))) {
  const file = `skills/${d}/SKILL.md`;
  if (!existsSync(P('skills', d, 'SKILL.md'))) { err(`skills/${d}`, 'missing SKILL.md'); continue; }
  const fm = frontmatter(read(P('skills', d, 'SKILL.md')));
  if (!fm) { err(file, 'missing frontmatter'); continue; }
  if (fm.bad) err(file, `frontmatter: ${fm.bad}`);
  const { data, body } = fm;
  if (data.name !== d) err(file, `name must equal directory "${d}"`);
  for (const k of Object.keys(data)) if (!SKILL_KEYS.has(k)) err(file, `unknown frontmatter key "${k}" (Claude Code ignores it silently)`);
  if (!data.description) err(file, 'description required');
  else if (data.description.length > DESC_MAX) err(file, `description ${data.description.length} chars > ${DESC_MAX}`);
  const conditional = Array.isArray(data.paths) && data.paths.length > 0;
  if (d.startsWith('standards-')) {
    if (!conditional) err(file, 'standards skills must declare paths (conditional activation)');
    if (data['user-invocable'] !== false) err(file, 'standards skills should set user-invocable: false');
  }
  if (data['disable-model-invocation'] !== true) descChars += String(data.description || '').length;
  if (data.context === 'fork') {
    const a = String(data.agent || '');
    if (!a.startsWith(`${NS}:`) || !agents.has(a.slice(NS.length + 1))) err(file, `fork agent must be "${NS}:<existing agent>" (got "${a}")`);
    if (data.background !== false) err(file, 'forked gate skills must set background: false so the caller waits for the verdict');
  }
  if (/\$ARGUMENTS/.test(body) && !data['argument-hint']) warn(file, 'uses $ARGUMENTS without argument-hint');
  if (/CLAUDE\.md/.test(body)) err(file, 'references CLAUDE.md, which plugins do not ship');
  skills.set(d, data);
}
if (!skills.has('eng')) err('skills', 'orchestrator skill "eng" missing');

// ---------- hooks ----------
const HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SubagentStart',
  'SubagentStop', 'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact', 'Notification', 'PermissionRequest', 'TaskCreated', 'TaskCompleted', 'TeammateIdle']);
const hooksJson = json(P('hooks', 'hooks.json'), 'hooks/hooks.json') || {};
const wired = new Set();
for (const [event, groups] of Object.entries(hooksJson.hooks || {})) {
  if (!HOOK_EVENTS.has(event)) err('hooks/hooks.json', `unknown event "${event}"`);
  for (const g of groups) for (const h of g.hooks || []) {
    if (h.type !== 'command') continue;
    if (!Array.isArray(h.args)) err('hooks/hooks.json', `${event}: use exec form (command + args) so no shell parses the path (Windows-safe)`);
    for (const a of h.args || []) {
      const m = a.match(/^\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)$/);
      if (!m) { err('hooks/hooks.json', `${event}: arg "${a}" must be under \${CLAUDE_PLUGIN_ROOT}`); continue; }
      wired.add(m[1]);
      if (!existsSync(P(m[1]))) err('hooks/hooks.json', `${event}: missing ${m[1]}`);
    }
  }
}
for (const f of ls(P('hooks', 'scripts')).filter((f) => f.endsWith('.mjs'))) {
  if (!['lib.mjs', 'gates.mjs'].includes(f) && !wired.has(`hooks/scripts/${f}`)) warn(`hooks/scripts/${f}`, 'not wired in hooks.json');
}
for (const dir of ['hooks/scripts', 'scripts', 'scripts/lib']) for (const f of ls(P(dir)).filter((f) => f.endsWith('.mjs'))) {
  const chk = spawnSync(process.execPath, ['--check', P(dir, f)], { encoding: 'utf8' });
  if (chk.status !== 0) err(`${dir}/${f}`, `syntax error: ${chk.stderr.trim().split('\n')[0]}`);
}

// ---------- capability registry ----------
let reg = null;
try { reg = parseYaml(read(P('routing', 'capabilities.yaml'))); } catch (e) { err('routing/capabilities.yaml', e.message); }
if (reg) {
  const ids = new Set();
  for (const c of CLASSES) if (!reg.budgets?.[c]) err('routing/capabilities.yaml', `budget for ${c} missing`);
  const used = new Set();
  const FIELDS = ['id', 'agent', 'group', 'topology', 'purpose', 'triggers', 'risk_triggers', 'classes', 'inputs', 'outputs', 'tools', 'scopes', 'tier', 'max_turns', 'parallel', 'depends', 'reviewers', 'security'];
  const RW = 'routing/capabilities.yaml';
  for (const t of ['low', 'medium', 'high']) if (!MODELS.test(String(reg.tiers?.[t] || ''))) err(RW, `tiers.${t} must map to a model alias`);
  if (!Array.isArray(reg.risk_dimensions) || !reg.risk_dimensions.length) err(RW, 'risk_dimensions must be a non-empty list');
  for (const [g, classes] of Object.entries(reg.gates || {})) {
    if (!GATE_KEYS.has(g)) err(RW, `unknown gate "${g}" (known: ${[...GATE_KEYS].join(', ')})`);
    for (const cls of classes || []) if (!CLASSES.includes(cls)) err(RW, `gate ${g}: bad class "${cls}"`);
  }
  for (const [flag, re] of Object.entries(reg.risk_paths || {})) {
    if (!reg.risk_requirements?.[flag]) err(RW, `risk_paths ${flag} is not a known risk flag`);
    try { new RegExp(re, 'i'); } catch (e) { err(RW, `risk_paths ${flag}: invalid regex (${e.message})`); }
  }
  for (const c of reg.capabilities || []) {
    const where = `routing/capabilities.yaml#${c.id}`;
    for (const k of FIELDS) if (c[k] === undefined) err(where, `missing field "${k}"`);
    if (ids.has(c.id)) err(where, 'duplicate id');
    ids.add(c.id);
    const a = agents.get(c.agent);
    if (!a) { err(where, `agent "${c.agent}" does not exist`); continue; }
    used.add(c.agent);
    if (!reg.tiers?.[c.tier]) err(where, `tier "${c.tier}" not in tiers`);
    else if (reg.tiers[c.tier] !== a.model) err(where, `tier ${c.tier} → ${reg.tiers[c.tier]} ≠ agent model ${a.model}`);
    // Registry ↔ skill: a reviewer gate names the skill that runs it; a forked skill must use the same agent.
    if (c.reviewer_gate) {
      const s = skills.get(c.skill);
      if (!c.skill || !s) err(where, `reviewer_gate requires an existing skill (got "${c.skill}")`);
      else if (s.agent && s.agent !== `${NS}:${c.agent}`) err(where, `skill ${c.skill} forks ${s.agent}, but the capability's agent is ${NS}:${c.agent}`);
    } else if (c.skill !== undefined) err(where, '"skill" is only meaningful with reviewer_gate: true');
    if (c.max_turns !== a.maxTurns) err(where, `max_turns ${c.max_turns} ≠ agent maxTurns ${a.maxTurns}`);
    if ([...c.tools].sort().join() !== [...a.tools].sort().join()) err(where, `tools ≠ agent tools (${a.tools.join(', ')})`);
    if (!['stream', 'enabling', 'platform', 'subsystem'].includes(c.topology)) err(where, `bad topology "${c.topology}"`);
    for (const cls of c.classes || []) if (!CLASSES.includes(cls)) err(where, `bad class "${cls}"`);
  }
  for (const c of reg.capabilities || []) for (const k of ['depends', 'reviewers']) for (const r of c[k] || []) if (!ids.has(r)) err(`routing/capabilities.yaml#${c.id}`, `${k} references unknown "${r}"`);
  const byId = new Map((reg.capabilities || []).map((c) => [c.id, c]));
  for (const [cls, b] of Object.entries(reg.budgets || {})) for (const r of b.reviewers || []) {
    if (!ids.has(r)) err('routing/capabilities.yaml', `budget ${cls} reviewer "${r}" unknown`);
    else if (!byId.get(r).reviewer_gate) err('routing/capabilities.yaml', `budget ${cls} reviewer "${r}" must be a reviewer_gate capability`);
  }
  for (const [flag, list] of Object.entries(reg.risk_requirements || {})) for (const r of list) if (!ids.has(r)) err('routing/capabilities.yaml', `risk ${flag} → unknown "${r}"`);
  for (const flag of Object.keys(reg.risk_requirements || {})) if (typeof reg.risk_deliverables?.[flag] !== 'string') err('routing/capabilities.yaml', `risk flag ${flag} has no risk_deliverables entry`);
  for (const flag of Object.keys(reg.risk_deliverables || {})) if (!reg.risk_requirements?.[flag]) err('routing/capabilities.yaml', `risk_deliverables ${flag} is not a known risk flag`);
  for (const name of agents.keys()) if (!used.has(name)) err(`agents/${name}.md`, 'not referenced by any capability (dead agent)');
}

// ---------- cross-references ----------
const docs = [];
for (const d of ['agents', 'skills', 'templates']) {
  const walk = (dir) => { for (const f of ls(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.md')) docs.push(p); } };
  walk(P(d));
}
docs.push(P('README.md'), P('constitution.md'));
for (const p of docs) {
  if (!existsSync(p)) continue;
  const file = relative(ROOT, p).replace(/\\/g, '/');
  const text = read(p);
  for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.(?:md|mjs|json|yaml))/g)) if (!existsSync(P(m[1]))) err(file, `broken reference \${CLAUDE_PLUGIN_ROOT}/${m[1]}`);
  for (const m of text.matchAll(/\/engineering-os:([a-z][\w-]*)/g)) if (!skills.has(m[1])) err(file, `unknown skill /engineering-os:${m[1]}`);
  for (const m of text.matchAll(/`engineering-os:([a-z][\w-]*)`/g)) if (!agents.has(m[1]) && !skills.has(m[1])) err(file, `unknown agent/skill engineering-os:${m[1]}`);
  for (const m of text.matchAll(/(?<![\w/:-])\/eng(-[a-z]+)?\b/g)) err(file, `bare "/eng${m[1] || ''}" — plugin skills are namespaced (/engineering-os:…)`);
}

// ---------- budgets ----------
const constitution = existsSync(P('constitution.md')) ? read(P('constitution.md')) : '';
if (!constitution) err('constitution.md', 'missing (injected into every session and org subagent)');
const cLines = constitution.split('\n').length;
if (cLines > 45) err('constitution.md', `${cLines} lines > 45 (always loaded)`);
if (constitution.length > 9000) err('constitution.md', 'over 9000 chars (SubagentStart additionalContext limit is 10k)');
if (descChars > DESC_BUDGET) err('plugin', `always-on descriptions ${descChars} chars > budget ${DESC_BUDGET}; shorten descriptions (check triggering evals) before raising the budget`);

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${agents.size} agents · ${skills.size} skills (${[...skills.keys()].filter((s) => s.startsWith('standards-')).length} conditional standards) · ${reg?.capabilities?.length ?? 0} capabilities · ${wired.size} hooks · ` +
  `descriptions ≈ ${descChars} chars (~${Math.round(descChars / 4)} tokens) · constitution ${cLines} lines (~${Math.round(constitution.length / 4)} tokens)`);
console.log(errors.length ? `FAILED: ${errors.length} error(s)` : 'OK: engineering-os plugin valid');
process.exit(errors.length ? 1 : 0);
