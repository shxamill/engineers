#!/usr/bin/env node
// Stop (main session) — deterministic completion gate, blocks ONCE per stop attempt (stop_hook_active).
// When source files changed this session (working tree or commits since session start), requires, at the
// current content fingerprint: eng-verify evidence, declared class/flags, class fitting the diff, risk flags
// fitting the changed paths, acceptance criteria / completed plan by class, and a PASS from each required
// reviewer. Gate logic lives in gates.mjs (shared with eng-status). Fails open on its own errors.
// Opt out per project with "stopGate": false in docs/engineering/project-profile.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, block, projectDir, logEvent } from './lib.mjs';

try {
  const input = readInput();
  if (input.stop_hook_active) process.exit(0);
  const dir = projectDir();
  let profile = null;
  try { profile = JSON.parse(readFileSync(join(dir, 'docs', 'engineering', 'project-profile.json'), 'utf8')); } catch {}
  if (profile?.stopGate === false) process.exit(0);
  const { evaluateGates } = await import('./gates.mjs');
  const r = evaluateGates(dir, { sessionId: input.session_id });
  if (!r.applies) process.exit(0);
  logEvent(dir, { event: 'gate', result: r.missing.length ? 'block' : 'pass', missing: [...new Set(r.missing.map((m) => m.key))] });
  if (!r.missing.length) process.exit(0);
  block(
    `Completion gate: ${r.source.length} source file(s) changed this session (e.g. ${r.source.slice(0, 3).join(', ')}), but required evidence is missing or stale:\n- ${r.missing.map((m) => m.msg).join('\n- ')}\n` +
      'Run them now (or record a reason where the message allows it), then give the final report with the results.',
  );
} catch {
  process.exit(0);
}
