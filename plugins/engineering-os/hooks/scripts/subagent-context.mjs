#!/usr/bin/env node
// SubagentStart (org agents only, via matcher): inject the constitution so every specialist shares the
// same non-negotiables and handoff contract without a CLAUDE.md. Capped well below the 10k-char limit.
// Also records a `spawn` telemetry event (agent, agent_id) so the status report can show active agents.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, pluginRoot, projectDir, bareAgentName, logEvent } from './lib.mjs';

const input = readInput();
logEvent(projectDir(), { event: 'spawn', agent: bareAgentName(input.agent_type), agent_id: input.agent_id || null });
let text = '';
try {
  text = readFileSync(join(pluginRoot(), 'constitution.md'), 'utf8').trim().slice(0, 9000);
} catch {
  process.exit(0);
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } }));
