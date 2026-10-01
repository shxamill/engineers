#!/usr/bin/env node
// SessionStart: inject a compact engineering snapshot so work resumes from durable state, not chat history.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, projectDir } from './lib.mjs';

readInput();
const dir = projectDir();
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const lines = [];
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(no commits)';
const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
const worktrees = git('worktree', 'list').split('\n').filter(Boolean).length;
lines.push(`[eng-org] branch=${branch} uncommitted=${dirty}${worktrees > 1 ? ` worktrees=${worktrees}` : ''}`);

const statusPath = join(dir, 'docs', 'engineering', 'status.md');
if (existsSync(statusPath)) {
  const all = readFileSync(statusPath, 'utf8').split(/\r?\n/);
  const start = all.findIndex((l) => /^## Now\b/.test(l));
  const rest = start < 0 ? [] : all.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const now = (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim()).slice(0, 20);
  if (now.length) lines.push('[eng-org] docs/engineering/status.md → Now:', ...now);
} else {
  lines.push('[eng-org] docs/engineering/status.md missing — create it from the eng-status skill before starting work.');
}
lines.push('[eng-org] New work: /eng <goal>. Reconcile state: /eng-status.');
process.stdout.write(`${lines.join('\n')}\n`);
