#!/usr/bin/env node
// PreToolUse(Read|Edit|Write|MultiEdit|NotebookEdit): keep secrets out of the transcript and the repo.
import { readInput, block, isSecretPath, findSecret } from './lib.mjs';

const input = readInput();
const ti = input?.tool_input ?? {};
const path = ti.file_path || ti.notebook_path || ti.path || '';
const tag = 'BLOCKED by .claude/hooks/guard-secrets.mjs';

if (isSecretPath(path))
  block(
    `${tag}: "${path}" is a secrets file. Agents never read or write real credentials (CLAUDE.md → Human decision gates). ` +
      'Use or create a placeholder file such as .env.example and ask the user to set real values.',
  );

const written = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])]
  .filter((s) => typeof s === 'string')
  .join('\n');
const found = findSecret(written);
if (found)
  block(
    `${tag}: the content being written to "${path}" contains what looks like a real ${found}. ` +
      'Read credentials from environment variables instead. For test fixtures, build an obviously fake value at runtime.',
  );
process.exit(0);
