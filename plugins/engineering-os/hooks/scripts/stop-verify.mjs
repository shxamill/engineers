#!/usr/bin/env node
// Stop (main session) — deterministic completion gate, blocks ONCE per stop attempt (stop_hook_active):
//  1. Source files changed this session (working tree OR commits since session start) need verification
//     evidence (.eng/evidence/verify-latest.json) newer than the latest change.
//  2. The class/flags in docs/engineering/status.md (Now) imply required reviewers (registry budgets +
//     risk requirements). Each needs a PASS verdict in .eng/evidence/gates.jsonl newer than the latest change;
//     a newer CHANGES_REQUIRED means the fix must be re-reviewed.
// Fails open on errors. Opt out per project with "stopGate": false in project-profile.json.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, block, projectDir, pluginRoot } from './lib.mjs';

const NON_SOURCE = /(^|\/)(docs|\.eng|\.claude|\.github\/ISSUE_TEMPLATE)\/|\.(md|mdx|txt|rst|png|jpe?g|gif|svg|ico|lock)$|(^|\/)(LICENSE|CHANGELOG|\.gitignore)$/i;
const GATE_SKILL = { 'code-reviewer': '/engineering-os:eng-review', 'scope-judge': '/engineering-os:eng-judge', 'security-engineer': '/engineering-os:eng-secreview', 'adversarial-qa': '/engineering-os:eng-test (adversarial QA)' };

try {
  const input = readInput();
  if (input.stop_hook_active) process.exit(0);
  const dir = projectDir();
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  if (readJson(join(dir, 'docs', 'engineering', 'project-profile.json'))?.stopGate === false) process.exit(0);
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });

  const changed = new Set(git('status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()));
  const sid = String(input.session_id || '').replace(/[^\w-]/g, '');
  const start = sid ? readJson(join(dir, '.eng', 'state', `session-${sid}.json`)) : null;
  if (start?.head) {
    try { for (const f of git('diff', '--name-only', start.head, 'HEAD').split('\n').filter(Boolean)) changed.add(f); } catch {}
  }
  const source = [...changed].filter((f) => !NON_SOURCE.test(f));
  if (!source.length) process.exit(0);
  const latest = Math.max(...source.map((f) => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } }));

  const missing = [];
  const evidence = join(dir, '.eng', 'evidence', 'verify-latest.json');
  if (!(existsSync(evidence) && statSync(evidence).mtimeMs >= latest && readJson(evidence)?.verdict))
    missing.push('verification: run /engineering-os:eng-verify');

  // Required reviewers from the declared class and risk flags.
  const status = existsSync(join(dir, 'docs', 'engineering', 'status.md')) ? readFileSync(join(dir, 'docs', 'engineering', 'status.md'), 'utf8') : '';
  const now = (status.split(/^## /m).find((s) => s.startsWith('Now')) || '');
  const cls = (now.match(/Class:\s*\**\s*(TRIVIAL|SMALL|MEDIUM|LARGE|CRITICAL)\b/) || [])[1];
  if (!cls) missing.push('classification: record `Class:` and `Flags:` in docs/engineering/status.md Now (/engineering-os:eng-intake); review gates are derived from it');
  if (cls && cls !== 'TRIVIAL') {
    const { parseYaml } = await import(new URL('../../scripts/lib/yaml-lite.mjs', import.meta.url));
    const reg = parseYaml(readFileSync(join(pluginRoot(), 'routing', 'capabilities.yaml'), 'utf8'));
    const flags = ((now.match(/Flags:\s*([^\n·]*)/) || [])[1] || '').split(/[,\s]+/).filter((f) => reg.risk_requirements?.[f]);
    const caps = new Set(reg.budgets?.[cls]?.reviewers || []);
    for (const f of flags) for (const id of reg.risk_requirements[f]) if (['appsec', 'supply-chain', 'privacy'].includes(id)) caps.add(id);
    const agents = new Set([...caps].map((id) => reg.capabilities.find((c) => c.id === id)?.agent).filter(Boolean));
    const ledger = existsSync(join(dir, '.eng', 'evidence', 'gates.jsonl'))
      ? readFileSync(join(dir, '.eng', 'evidence', 'gates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      : [];
    for (const agent of agents) {
      const fresh = ledger.filter((g) => g.agent === agent && g.at >= latest - 1000).sort((a, b) => b.at - a.at)[0];
      if (!fresh) missing.push(`${agent} review (required for ${cls}${flags.length ? ` + ${flags.join(',')}` : ''}): run ${GATE_SKILL[agent] || agent}`);
      else if (fresh.status !== 'PASS') missing.push(`${agent} returned ${fresh.status}: fix the findings and re-run ${GATE_SKILL[agent] || agent}`);
    }
  }
  if (!missing.length) process.exit(0);
  block(
    `Completion gate: ${source.length} source file(s) changed this session (e.g. ${source.slice(0, 3).join(', ')}), but required evidence is missing or stale:\n- ${missing.join('\n- ')}\n` +
      'Run them now (or state precisely why a gate does not apply and record it in status.md), then give the final report with the results.',
  );
} catch {
  process.exit(0);
}
