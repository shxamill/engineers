#!/usr/bin/env node
// Stop (main session): if source files changed after the last verification evidence, block ONCE and ask for
// /engineering-os:eng-verify. A deterministic gate against finishing with unverified code. Fails open on errors;
// `stop_hook_active` prevents loops; opt out per project with "stopGate": false in project-profile.json.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, block, projectDir } from './lib.mjs';

const NON_SOURCE = /(^|\/)(docs|\.eng|\.claude|\.github\/ISSUE_TEMPLATE)\/|\.(md|mdx|txt|rst|png|jpe?g|gif|svg|ico|lock)$|(^|\/)(LICENSE|CHANGELOG|\.gitignore)$/i;

try {
  const input = readInput();
  if (input.stop_hook_active) process.exit(0);
  const dir = projectDir();
  const profilePath = join(dir, 'docs', 'engineering', 'project-profile.json');
  if (existsSync(profilePath) && JSON.parse(readFileSync(profilePath, 'utf8')).stopGate === false) process.exit(0);

  const status = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const changed = status
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop())
    .filter((f) => !NON_SOURCE.test(f));
  if (!changed.length) process.exit(0);

  const latest = Math.max(...changed.map((f) => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } }));
  const evidencePath = join(dir, '.eng', 'evidence', 'verify-latest.json');
  if (existsSync(evidencePath)) {
    const ev = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (statSync(evidencePath).mtimeMs >= latest && ev.verdict) process.exit(0);
  }
  block(
    `Verification gate: ${changed.length} source file(s) changed (e.g. ${changed.slice(0, 3).join(', ')}) with no verification evidence newer than the changes. ` +
      'Run /engineering-os:eng-verify (or report exactly why verification does not apply), then give the final report with its results.',
  );
} catch {
  process.exit(0);
}
