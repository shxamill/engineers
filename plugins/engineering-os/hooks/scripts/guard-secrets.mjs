#!/usr/bin/env node
// PreToolUse(Read|Edit|Write|MultiEdit|NotebookEdit|Grep): keep secrets out of the transcript and the repo,
// and keep the OS's own evidence/state files engine-written.
// Secrets are a human decision gate, so matches go to the human ("ask"); headless sessions refuse.
// Writes to verification evidence, the gate ledger, session state, or telemetry are denied (V3, A-02).
import { existsSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { readInput, decide, isSecretPath, mentionsSecretPath, findSecret, PROTECTED_STATE, projectDir, logEvent } from './lib.mjs';

// Canonical form for the evidence check: forward slashes, `.`/`..`/`//` resolved, and symlinks in the existing
// part of the path resolved (so an alias such as `e -> .eng` can't reach .eng/state).
function canonical(p) {
  let s = posix.normalize(String(p).replace(/\\/g, '/'));
  try {
    const tail = [];
    let cur = s;
    while (cur && !existsSync(cur) && posix.dirname(cur) !== cur) { tail.unshift(posix.basename(cur)); cur = posix.dirname(cur); }
    if (cur && existsSync(cur)) s = posix.join(realpathSync(cur).replace(/\\/g, '/'), ...tail);
  } catch {}
  return s;
}

const input = readInput();
const log = (decision, reason) => logEvent(projectDir(), { event: 'guard', hook: 'guard-secrets', decision, reasons: [reason] });
try {
  const ti = input?.tool_input ?? {};
  const path = ti.file_path || ti.notebook_path || ti.path || '';
  const writes = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(input?.tool_name) || 'content' in ti || 'new_string' in ti || 'edits' in ti;

  const canon = path ? canonical(path) : '';
  if (writes && (PROTECTED_STATE.test(canon) || PROTECTED_STATE.test(String(path).replace(/\\/g, '/')))) {
    log('deny', 'edit of OS evidence/state');
    decide(
      'deny',
      `guard-secrets: "${path}" is Engineering OS evidence/state. Only eng-verify and the hooks write verification evidence, ` +
        'the gate ledger, .eng/state, and telemetry. Run /engineering-os:eng-verify or the review skill instead.',
    );
  }

  if (writes && /(^|\/)docs\/engineering\/project-profile\.json$/i.test(canon)) {
    log('ask', 'project profile change');
    decide(
      'ask',
      `guard-secrets: "${path}" defines what verification runs and can disable the completion gate ("stopGate"). ` +
        'Changing it needs explicit human approval; run eng-detect (/engineering-os:eng-init) to re-detect checks instead.',
    );
  }

  if (isSecretPath(path) || (typeof ti.glob === 'string' && mentionsSecretPath(ti.glob))) {
    log('ask', 'secrets file');
    decide(
      'ask',
      `guard-secrets: "${path}" is a secrets file; agents don't read or write real credentials without explicit human approval. ` +
        'Prefer a placeholder file such as .env.example and let the user set real values.',
    );
  }

  const written = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])]
    .filter((s) => typeof s === 'string')
    .join('\n');
  const found = findSecret(written);
  if (found) {
    log('ask', `credential literal (${found})`);
    decide(
      'ask',
      `guard-secrets: the content for "${path}" contains what looks like a real ${found}. ` +
        'Read credentials from environment variables instead; build obviously fake fixture values at runtime.',
    );
  }
} catch (e) {
  decide('ask', `guard-secrets could not analyze this call (${e?.message || e}); human review required`);
}
process.exit(0);
