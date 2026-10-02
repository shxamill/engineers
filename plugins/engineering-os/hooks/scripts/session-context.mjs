#!/usr/bin/env node
// SessionStart: inject the constitution plus a compact engineering snapshot, so work resumes from
// durable state rather than chat history. Plugins cannot ship CLAUDE.md; this hook replaces it.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, projectDir, pluginRoot } from './lib.mjs';

const input = readInput();
const dir = projectDir();
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const lines = [];
try {
  lines.push(readFileSync(join(pluginRoot(), 'constitution.md'), 'utf8').trim(), '');
} catch {}

// Remember where this session started so the Stop gate also sees work that was committed during it.
const head = git('rev-parse', 'HEAD');
const sid = String(input.session_id || '').replace(/[^\w-]/g, '');
if (sid && head) {
  const stateFile = join(dir, '.eng', 'state', `session-${sid}.json`);
  try {
    if (!existsSync(stateFile)) {
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify({ head, at: Date.now() }));
    }
  } catch {}
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(no commits)';
const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
const worktrees = git('worktree', 'list').split('\n').filter(Boolean).length;
lines.push(`[eng-os] branch=${branch} uncommitted=${dirty}${worktrees > 1 ? ` worktrees=${worktrees}` : ''} sandbox=${sandboxSetting()}`);

// What the settings files say about the OS sandbox (most specific wins). This reports configuration only;
// whether the platform can enforce it (macOS, Linux, WSL2 — not native Windows) is shown by /sandbox.
function sandboxSetting() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  for (const f of [join(dir, '.claude', 'settings.local.json'), join(dir, '.claude', 'settings.json'), home && join(home, '.claude', 'settings.json')]) {
    if (!f) continue;
    try {
      const v = JSON.parse(readFileSync(f, 'utf8'))?.sandbox?.enabled;
      if (typeof v === 'boolean') return v ? 'on (settings; check /sandbox)' : 'off';
    } catch {}
  }
  return 'not configured';
}

const profilePath = join(dir, 'docs', 'engineering', 'project-profile.json');
if (existsSync(profilePath)) {
  try {
    const p = JSON.parse(readFileSync(profilePath, 'utf8'));
    const kinds = [...new Set((p.checks || []).map((c) => c.kind))].join(',') || 'none';
    lines.push(`[eng-os] project: ${(p.languages || []).join('+') || '?'} · ${p.packageManager || '-'} · checks: ${kinds} (docs/engineering/project-profile.json)`);
  } catch {
    lines.push('[eng-os] docs/engineering/project-profile.json is unreadable; re-run /engineering-os:eng-init.');
  }
} else {
  lines.push('[eng-os] No project profile yet: run /engineering-os:eng-init once to detect stack, checks, and recommended settings.');
}

const statusPath = join(dir, 'docs', 'engineering', 'status.md');
if (existsSync(statusPath)) {
  const all = readFileSync(statusPath, 'utf8').split(/\r?\n/);
  const start = all.findIndex((l) => /^## Now\b/.test(l));
  const rest = start < 0 ? [] : all.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const now = (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim()).slice(0, 20);
  if (now.length) lines.push('[eng-os] docs/engineering/status.md → Now:', ...now);
} else {
  lines.push('[eng-os] docs/engineering/status.md missing — created by /engineering-os:eng-init or /engineering-os:eng-status.');
}
process.stdout.write(`${lines.join('\n')}\n`);
