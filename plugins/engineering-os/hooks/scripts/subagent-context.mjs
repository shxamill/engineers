#!/usr/bin/env node
// SubagentStart (org agents only, via matcher): inject the constitution so every specialist shares the
// same non-negotiables and handoff contract without a CLAUDE.md. Capped well below the 10k-char limit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, pluginRoot } from './lib.mjs';

readInput();
let text = '';
try {
  text = readFileSync(join(pluginRoot(), 'constitution.md'), 'utf8').trim().slice(0, 9000);
} catch {
  process.exit(0);
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } }));
