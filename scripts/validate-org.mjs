#!/usr/bin/env node
// Validates the engineering-org configuration (agents, skills, rules, hooks, references, context budgets).
// Run from anywhere: node scripts/validate-org.mjs   (exit 1 on errors)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...p) => join(ROOT, ...p);
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);
const read = (p) => readFileSync(p, 'utf8');
const ls = (p) => (existsSync(p) ? readdirSync(p) : []);

// Minimal YAML frontmatter parser for the flat shapes used here (scalars, inline and block lists).
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const data = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) return { data, body: m[2], bad: line };
    const [, k, v] = kv;
    listKey = null;
    if (v === '') {
      data[k] = [];
      listKey = k;
    } else if (/^\[.*\]$/.test(v)) data[k] = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    else data[k] = unquote(v);
  }
  return { data, body: m[2] };
}
function unquote(s) {
  const t = s.trim();
  if (/^(["']).*\1$/.test(t)) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
}
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const KNOWN_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Bash', 'PowerShell', 'WebSearch',
  'WebFetch', 'Skill', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'LSP']);
const SPAWN_TOOLS = new Set(['Agent', 'Task']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_ONLY_AGENTS = new Set(['code-reviewer', 'adversarial-qa']); // independence: reviewers never modify code
const MODELS = /^(inherit|sonnet|opus|haiku|fable|claude-[\w.-]+)$/;
const EFFORT = /^(low|medium|high|max|\d+)$/;
const BUILTIN_AGENTS = new Set(['Explore', 'general-purpose', 'Plan', 'claude', 'statusline-setup', 'claude-code-guide']);
const BUILTIN_COMMANDS = new Set(['add-dir', 'agents', 'bug', 'clear', 'code-review', 'compact', 'config', 'context', 'cost', 'debug', 'doctor',
  'export', 'help', 'hooks', 'ide', 'init', 'install-github-app', 'login', 'logout', 'loop', 'mcp', 'memory', 'model', 'permissions', 'plan',
  'pr-comments', 'release-notes', 'resume', 'review', 'run', 'security-review', 'simplify', 'skills', 'status', 'terminal-setup', 'upgrade',
  'usage', 'vim']);
const DESC_MAX = 300;
let descChars = 0;

// ---------- agents ----------
const agentDir = P('.claude', 'agents');
const agents = new Map();
for (const f of ls(agentDir).filter((f) => f.endsWith('.md'))) {
  const file = `.claude/agents/${f}`;
  const fm = frontmatter(read(join(agentDir, f)));
  if (!fm) { err(file, 'missing YAML frontmatter'); continue; }
  if (fm.bad) err(file, `unparseable frontmatter line: ${fm.bad}`);
  const { data, body } = fm;
  const expected = f.slice(0, -3);
  if (data.name !== expected) err(file, `name "${data.name}" must equal filename "${expected}"`);
  if (!/^[a-z][a-z0-9-]*$/.test(String(data.name))) err(file, 'name must be lowercase-hyphenated');
  if (!data.description) err(file, 'description required');
  else if (data.description.length > DESC_MAX) err(file, `description ${data.description.length} chars > ${DESC_MAX} (always in context)`);
  descChars += String(data.description || '').length;
  if (data.model && !MODELS.test(data.model)) err(file, `unknown model "${data.model}"`);
  if (data.effort && !EFFORT.test(String(data.effort))) err(file, `invalid effort "${data.effort}"`);
  const tools = asList(data.tools);
  if (!tools.length) warn(file, 'no tools list: agent inherits every tool (least privilege prefers an explicit list)');
  for (const t of tools) {
    if (SPAWN_TOOLS.has(t)) err(file, `tool "${t}": subagents cannot spawn subagents`);
    else if (!KNOWN_TOOLS.has(t) && !t.startsWith('mcp__')) err(file, `unknown tool "${t}"`);
  }
  if (READ_ONLY_AGENTS.has(expected) && tools.some((t) => WRITE_TOOLS.has(t))) err(file, 'read-only agent must not have write tools');
  if (body.trim().length < 200) err(file, 'body too short to be a useful role definition');
  if (!/Handoff/.test(body)) err(file, 'body must require the Handoff format');
  agents.set(expected, data);
}
if (!agents.size) err('.claude/agents', 'no agents found');

// ---------- skills ----------
const skillDir = P('.claude', 'skills');
const skills = new Map();
for (const d of ls(skillDir)) {
  const file = `.claude/skills/${d}/SKILL.md`;
  if (!existsSync(P('.claude', 'skills', d, 'SKILL.md'))) { err(`.claude/skills/${d}`, 'missing SKILL.md'); continue; }
  const fm = frontmatter(read(P('.claude', 'skills', d, 'SKILL.md')));
  if (!fm) { err(file, 'missing YAML frontmatter'); continue; }
  if (fm.bad) err(file, `unparseable frontmatter line: ${fm.bad}`);
  const { data, body } = fm;
  if (data.name !== d) err(file, `name "${data.name}" must equal directory "${d}"`);
  if (BUILTIN_COMMANDS.has(d)) err(file, `"/${d}" collides with a built-in command`);
  if (!data.description) err(file, 'description required');
  else if (data.description.length > DESC_MAX) err(file, `description ${data.description.length} chars > ${DESC_MAX}`);
  if (data['disable-model-invocation'] !== true) descChars += String(data.description || '').length;
  if (data.context && !['inline', 'fork'].includes(data.context)) err(file, `context must be inline|fork, got "${data.context}"`);
  if (data.context === 'fork') {
    if (!data.agent) err(file, 'context: fork requires agent');
    else if (!agents.has(data.agent) && !BUILTIN_AGENTS.has(data.agent)) err(file, `fork agent "${data.agent}" does not exist`);
    if (data.background !== false) warn(file, 'forked skills run in the background by default; set background: false to wait for the result');
  } else if (data.agent) warn(file, 'agent is ignored unless context: fork');
  if (/\$ARGUMENTS/.test(body) && !data['argument-hint']) warn(file, 'uses $ARGUMENTS but has no argument-hint');
  if (data.model && !MODELS.test(data.model)) err(file, `unknown model "${data.model}"`);
  skills.set(d, data);
}
if (!skills.has('eng')) err('.claude/skills', 'orchestrator skill "eng" missing');

// ---------- rules ----------
for (const f of ls(P('.claude', 'rules')).filter((f) => f.endsWith('.md'))) {
  const file = `.claude/rules/${f}`;
  const fm = frontmatter(read(P('.claude', 'rules', f)));
  if (!fm || !Array.isArray(fm.data.paths) || !fm.data.paths.length)
    err(file, 'rules must declare non-empty `paths:` (unscoped rules load into every context; put universal rules in CLAUDE.md)');
  else if (fm.data.paths.some((p) => typeof p !== 'string' || !p.trim())) err(file, 'paths entries must be non-empty strings');
}

// ---------- settings + hooks ----------
const HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SubagentStart',
  'SubagentStop', 'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact', 'Notification', 'PermissionRequest']);
let settings = {};
try {
  settings = JSON.parse(read(P('.claude', 'settings.json')));
} catch (e) {
  err('.claude/settings.json', `invalid JSON: ${e.message}`);
}
const wired = new Set();
for (const [event, groups] of Object.entries(settings.hooks || {})) {
  if (!HOOK_EVENTS.has(event)) err('.claude/settings.json', `unknown hook event "${event}"`);
  for (const g of groups) {
    for (const h of g.hooks || []) {
      if (h.type !== 'command') continue;
      if (/\$CLAUDE_PROJECT_DIR/.test(h.command) && !h.args)
        warn('.claude/settings.json', `${event} hook uses shell form; prefer exec form (command + args) so Windows PowerShell can't drop the path`);
      for (const m of [h.command, ...(h.args || [])].join(' ').matchAll(/\.claude\/hooks\/([\w.-]+)/g)) {
        wired.add(m[1]);
        if (!existsSync(P('.claude', 'hooks', m[1]))) err('.claude/settings.json', `${event} hook references missing .claude/hooks/${m[1]}`);
      }
    }
  }
}
for (const f of ls(P('.claude', 'hooks')).filter((f) => f.endsWith('.mjs'))) {
  const chk = spawnSync(process.execPath, ['--check', P('.claude', 'hooks', f)], { encoding: 'utf8' });
  if (chk.status !== 0) err(`.claude/hooks/${f}`, `syntax error: ${chk.stderr.trim().split('\n')[0]}`);
  if (f !== 'lib.mjs' && !wired.has(f)) warn(`.claude/hooks/${f}`, 'not wired in settings.json');
}

// ---------- cross-references ----------
const docFiles = [];
const walk = (dir) => {
  for (const f of ls(dir)) {
    const p = join(dir, f);
    if (['worktrees', 'node_modules', '.git'].includes(f)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.md')) docFiles.push(p);
  }
};
walk(P('.claude'));
walk(P('docs', 'engineering'));
for (const f of ['CLAUDE.md', 'README.md']) if (existsSync(P(f))) docFiles.push(P(f));

const LAZY = new Set(['product', 'research', 'requirements', 'ux', 'architecture', 'security', 'implementation-plan', 'test-plan', 'release-plan']
  .map((n) => `docs/engineering/${n}.md`));
const placeholder = (s) => /NNNN|<|slug|\*|\.\.\./.test(s);
for (const p of docFiles) {
  const file = rel(p);
  const text = read(p);
  for (const m of text.matchAll(/(?:docs\/engineering|\.claude|scripts)\/[\w./-]*[\w-]\.(?:md|mjs|json)\b/g)) {
    const ref = m[0];
    if (placeholder(ref) || LAZY.has(ref) || ref.startsWith('.claude/settings.local')) continue;
    if (!existsSync(P(ref))) err(file, `broken reference ${ref}`);
  }
  for (const m of text.matchAll(/templates\/([\w-]+\.md)|template `([\w-]+\.md)`/g)) {
    const t = m[1] || m[2];
    if (!existsSync(P('docs', 'engineering', 'templates', t))) err(file, `missing template ${t}`);
  }
  for (const m of text.matchAll(/`\/(eng(?:-[a-z]+)?)\b/g)) if (!skills.has(m[1])) err(file, `references unknown skill /${m[1]}`);
}

// Staffing tables must stay in sync with the agent files.
const engSkill = existsSync(P('.claude', 'skills', 'eng', 'SKILL.md')) ? read(P('.claude', 'skills', 'eng', 'SKILL.md')) : '';
const manual = existsSync(P('docs', 'engineering', 'README.md')) ? read(P('docs', 'engineering', 'README.md')) : '';
for (const name of agents.keys()) {
  if (!new RegExp(`^\\|\\s*${name}\\s*\\|`, 'm').test(engSkill)) err('.claude/skills/eng/SKILL.md', `staffing table missing agent "${name}"`);
  if (!manual.includes(`\`${name}\``)) err('docs/engineering/README.md', `org chart missing agent "${name}"`);
}
for (const m of engSkill.matchAll(/^\|\s*([a-z][a-z0-9-]+)\s*\|/gm))
  if (!agents.has(m[1]) && m[1] !== 'gate' && m[1] !== 'class' && m[1] !== 'agent') err('.claude/skills/eng/SKILL.md', `staffing table lists unknown agent "${m[1]}"`);

// ---------- context budgets ----------
const claudeLines = existsSync(P('CLAUDE.md')) ? read(P('CLAUDE.md')).split('\n').length : 0;
if (!claudeLines) err('CLAUDE.md', 'missing');
else if (claudeLines > 80) err('CLAUDE.md', `${claudeLines} lines > 80 (loaded into every context, including subagents)`);
const status = existsSync(P('docs', 'engineering', 'status.md')) ? read(P('docs', 'engineering', 'status.md')) : '';
if (!status) warn('docs/engineering/status.md', 'missing (create with /eng-status)');
else {
  const now = (status.split(/^## /m).find((s) => s.startsWith('Now')) || '').split('\n').slice(1).filter((l) => l.trim());
  if (!now.length) err('docs/engineering/status.md', 'missing "## Now" section (injected at session start)');
  if (now.length > 15) err('docs/engineering/status.md', `Now section has ${now.length} lines > 15`);
}

// ---------- report ----------
for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(
  `\n${agents.size} agents, ${skills.size} skills, ${ls(P('.claude', 'rules')).length} rules, ${wired.size} hooks wired · ` +
    `always-loaded descriptions ≈ ${descChars} chars (~${Math.round(descChars / 4)} tokens) · CLAUDE.md ${claudeLines} lines`,
);
console.log(errors.length ? `FAILED: ${errors.length} error(s)` : 'OK: org configuration valid');
process.exit(errors.length ? 1 : 0);
