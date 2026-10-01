#!/usr/bin/env node
// SubagentStop: org agents (plugin agents/*.md, addressed as "engineering-os:<name>") must end with the
// Handoff block, and PASS requires EVIDENCE.
import { readdirSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, block, pluginRoot, projectDir, bareAgentName } from './lib.mjs';

const input = readInput();
if (input.stop_hook_active) process.exit(0);

let orgAgents = [];
try {
  orgAgents = readdirSync(join(pluginRoot(), 'agents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
} catch {
  process.exit(0);
}
const type = String(input.agent_type || '');
if (type.includes(':') && !type.startsWith('engineering-os:')) process.exit(0);
if (!orgAgents.includes(bareAgentName(type))) process.exit(0);

function lastAssistantText(transcriptPath) {
  try {
    const rows = readFileSync(transcriptPath, 'utf8').trim().split('\n').reverse();
    for (const row of rows) {
      const entry = JSON.parse(row);
      const content = entry?.message?.content;
      if (entry?.type !== 'assistant' || !Array.isArray(content)) continue;
      const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
      if (text.trim()) return text;
    }
  } catch {}
  return '';
}

const msg = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : lastAssistantText(input.agent_transcript_path);
if (!msg.trim()) process.exit(0);

const label = (name) => new RegExp(`^[\\s*_#>-]*${name}[*_\`]*\\s*:[*_\`\\s]*`, 'm');
const status = msg.match(new RegExp(`${label('STATUS').source}([A-Z_]+)`, 'm'));
if (!status)
  block(
    'Handoff missing. End your final message with the Handoff block from the constitution: ' +
      'STATUS / OBJECTIVE / CHANGED / RESULT / EVIDENCE / RISKS / FOLLOW_UP. Re-send your conclusion in that format now.',
  );

if (status[1] === 'PASS') {
  const start = msg.search(label('EVIDENCE'));
  let evidence = '';
  if (start >= 0) {
    const after = msg.slice(start).replace(label('EVIDENCE'), '');
    const next = after.search(/^[\s*_#>-]*(RISKS|FOLLOW_UP|RESULT|CHANGED|OBJECTIVE|STATUS)[*_]*\s*:/m);
    evidence = (next >= 0 ? after.slice(0, next) : after).trim();
  }
  // Empty, or a dismissal ("none", "n/a — docs only") with no command or number cited.
  if (!evidence || /^[-*\s]*([.\s]*$|(none|n\/?a|not run|not applicable|nothing|tbd|no evidence|skipped)\b[^`\d]*$)/i.test(evidence))
    block(
      'STATUS: PASS requires EVIDENCE — the commands/checks you actually ran this session and their outcomes. ' +
        'Run the verification now and report it, or change STATUS to FAIL or BLOCKED and say why.',
    );
}

// Accepted handoff: append to the gate ledger the Stop gate reads (reviewer verdicts must be current).
try {
  const dir = join(projectDir(), '.eng', 'evidence');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'gates.jsonl'), `${JSON.stringify({ agent: bareAgentName(type), status: status[1], at: Date.now() })}\n`);
} catch {}
process.exit(0);
