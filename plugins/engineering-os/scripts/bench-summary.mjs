#!/usr/bin/env node
// Summarize a `claude plugin eval --json` result into a compact Markdown benchmark report.
// Usage: node bench-summary.mjs <result.json> [--title "..."] > report.md
import { readFileSync } from 'node:fs';

const [path, ...rest] = process.argv.slice(2);
if (!path) { console.error('usage: bench-summary.mjs <result.json> [--title ...]'); process.exit(2); }
const title = rest[rest.indexOf('--title') + 1] && rest.includes('--title') ? rest[rest.indexOf('--title') + 1] : 'Engineering OS benchmark';
const r = JSON.parse(readFileSync(path, 'utf8'));
const runs = [];
for (const c of r.cases || []) for (const a of c.arms?.with || []) runs.push({ name: c.name, ...a });

const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : '-');
const lines = [`# ${title}`, '', `_Claude Code ${r.claudeVersion || r.claude_version || '?'} · started ${r.startedAt || r.started_at || '?'} · ${runs.length} runs · concurrency ${r.suite?.concurrency ?? r.concurrency ?? '?'} · model ${r.suite?.modelOverride || 'default'}${r.partial ? ` · PARTIAL` : ''}_`, ''];
lines.push('| Case | Score | Pass | Turns | Cost $ | Time s | Failed graders |', '|---|---|---|---|---|---|---|');
for (const x of runs) {
  const failed = (x.graders || []).filter((g) => g.scored !== false && !g.passed).map((g) => `${g.name}: ${String(g.explanation || '').replace(/\|/g, '/').slice(0, 90)}`);
  lines.push(`| ${x.name} | ${fmt(x.score)} | ${x.passed ? '✅' : '❌'} | ${x.turns ?? '-'} | ${fmt((x.costUsd || 0) + (x.judgeCostUsd || 0))} | ${x.durationSeconds ?? '-'} | ${x.error ? `ERROR: ${String(x.error).slice(0, 120)}` : failed.join('<br>') || '—'} |`);
}
const graders = runs.flatMap((x) => x.graders || []).filter((g) => g.scored !== false);
const by = (re) => graders.filter((g) => re.test(g.name));
const rate = (gs) => (gs.length ? `${gs.filter((g) => g.passed).length}/${gs.length}` : '-');
const totalCost = runs.reduce((s, x) => s + (x.costUsd || 0) + (x.judgeCostUsd || 0), 0);
lines.push('', '## Metrics', '| Metric | Value |', '|---|---|');
lines.push(`| Mean score | ${fmt(runs.reduce((s, x) => s + (x.score || 0), 0) / (runs.length || 1))} |`);
lines.push(`| Cases fully passed | ${runs.filter((x) => x.passed).length}/${runs.length} |`);
lines.push(`| Grader pass rate | ${rate(graders)} |`);
lines.push(`| Verification ran (VERDICT graders) | ${rate(by(/verified-with-engine/))} |`);
lines.push(`| Delegation within budget | ${rate(by(/no-delegation|at-most-one-agent/))} |`);
lines.push(`| Security controls held (no leak / no workaround / gate) | ${rate(by(/secret-not|no-workaround|wip-preserved|untracked-preserved|security-review-ran/))} |`);
lines.push(`| Scope discipline | ${rate(by(/untouched|scope|no-conflict|both-/))} |`);
lines.push(`| Test integrity (no weakening) | ${rate(by(/tests-|no-skips|tamper/))} |`);
lines.push(`| Mean turns | ${fmt(runs.reduce((s, x) => s + (x.turns || 0), 0) / (runs.length || 1), 1)} |`);
lines.push(`| Total cost (agent + judges) | $${fmt(totalCost)} |`);
lines.push(`| Errored runs | ${runs.filter((x) => x.error).length} |`);
console.log(lines.join('\n'));
