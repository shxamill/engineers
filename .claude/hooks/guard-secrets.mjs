#!/usr/bin/env node
// PreToolUse(Read|Edit|Write|MultiEdit|NotebookEdit): keep secrets out of the transcript and the repo.
// Secrets are a human decision gate, so matches go to the human ("ask"); headless sessions refuse.
import { readInput, decide, isSecretPath, mentionsSecretPath, findSecret } from './lib.mjs';

try {
  const ti = readInput()?.tool_input ?? {};
  const path = ti.file_path || ti.notebook_path || ti.path || '';

  if (isSecretPath(path) || (typeof ti.glob === 'string' && mentionsSecretPath(ti.glob)))
    decide(
      'ask',
      `guard-secrets: "${path}" is a secrets file; agents don't read or write real credentials without explicit human approval. ` +
        'Prefer a placeholder file such as .env.example and let the user set real values.',
    );

  const written = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])]
    .filter((s) => typeof s === 'string')
    .join('\n');
  const found = findSecret(written);
  if (found)
    decide(
      'ask',
      `guard-secrets: the content for "${path}" contains what looks like a real ${found}. ` +
        'Read credentials from environment variables instead; build obviously fake fixture values at runtime.',
    );
} catch (e) {
  decide('ask', `guard-secrets could not analyze this call (${e?.message || e}); human review required`);
}
process.exit(0);
