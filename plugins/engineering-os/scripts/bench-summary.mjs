#!/usr/bin/env node
// Summarize a `claude plugin eval --json` result into a compact Markdown benchmark report.
// Usage: node bench-summary.mjs <result.json> [--title "..."] > report.md
// Two-arm results (--ablation with-without, the default) are reported per arm, never merged (ADR-0004):
// mean score, pass^k (passed every run), cost, and the delta; with-only graders are indicators, not score.
import { readFileSync } from 'node:fs';

const [path, ...rest] = process.argv.slice(2);
if (!path) { console.error('usage: bench-summary.mjs <result.json> [--title ...]'); process.exit(2); }
const title = rest[rest.indexOf('--title') + 1] && rest.includes('--title') ? rest[rest.indexOf('--title') + 1] : 'Engineering OS benchmark';
const r = JSON.parse(readFileSync(path, 'utf8'));
const cases = r.cases || [];
const twoArm = cases.some((c) => (c.arms?.without || []).length);

const fmt = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '-');
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const cost = (x) => (x.costUsd || 0) + (x.judgeCostUsd || 0);
const failedOf = (x) => (x.graders || []).filter((g) => g.scored !== false && !g.passed)
  .map((g) => `${g.name}: ${String(g.explanation || '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 90)}`);
const header = (extra = '') => `_Claude Code ${r.claudeVersion || r.claude_version || '?'} · plugin ${r.suite?.plugins?.[0]?.version || '?'} · started ${r.startedAt || r.started_at || '?'} · model ${r.suite?.modelOverride || 'default'} · ablation ${r.suite?.ablation || '?'} · concurrency ${r.suite?.concurrency ?? r.concurrency ?? '?'}${extra}${r.partial ? ' · **PARTIAL (cost cap or abort)**' : ''}_`;

if (!twoArm) {
  const runs = [];
  for (const c of cases) for (const a of c.arms?.with || []) runs.push({ name: c.name, ...a });
  const lines = [`# ${title}`, '', header(` · ${runs.length} runs`), ''];
  lines.push('| Case | Score | Pass | Turns | Cost $ | Time s | Failed graders |', '|---|---|---|---|---|---|---|');
  for (const x of runs)
    lines.push(`| ${x.name} | ${fmt(x.score)} | ${x.passed ? '✅' : '❌'} | ${x.turns ?? '-'} | ${fmt(cost(x))} | ${x.durationSeconds ?? '-'} | ${x.error ? `ERROR: ${String(x.error).slice(0, 120)}` : failedOf(x).join('<br>') || '—'} |`);
  const graders = runs.flatMap((x) => x.graders || []).filter((g) => g.scored !== false);
  const by = (re) => graders.filter((g) => re.test(g.name));
  const rate = (gs) => (gs.length ? `${gs.filter((g) => g.passed).length}/${gs.length}` : '-');
  lines.push('', '## Metrics', '| Metric | Value |', '|---|---|');
  lines.push(`| Mean score | ${fmt(mean(runs.map((x) => x.score || 0)))} |`);
  lines.push(`| Cases fully passed | ${runs.filter((x) => x.passed).length}/${runs.length} |`);
  lines.push(`| Grader pass rate | ${rate(graders)} |`);
  lines.push(`| Verification ran (VERDICT graders) | ${rate(by(/verified-with-engine/))} |`);
  lines.push(`| Delegation within budget | ${rate(by(/no-delegation|at-most-one-agent/))} |`);
  lines.push(`| Security controls held (no leak / no workaround / gate) | ${rate(by(/secret-not|no-workaround|wip-preserved|untracked-preserved|security-review-ran/))} |`);
  lines.push(`| Scope discipline | ${rate(by(/untouched|scope|no-conflict|both-/))} |`);
  lines.push(`| Test integrity (no weakening) | ${rate(by(/tests-|no-skips|tamper/))} |`);
  lines.push(`| Mean turns | ${fmt(mean(runs.map((x) => x.turns || 0)), 1)} |`);
  lines.push(`| Total cost (agent + judges) | $${fmt(runs.reduce((s, x) => s + cost(x), 0))} |`);
  lines.push(`| Errored runs | ${runs.filter((x) => x.error).length} |`);
  console.log(lines.join('\n'));
  process.exit(0);
}

// Two arms: one row per case, each arm summarized over its own runs.
const arm = (c, a) => c.arms?.[a] || [];
const k = Math.max(...cases.map((c) => Math.max(arm(c, 'with').length, arm(c, 'without').length)));
const passK = (runs) => runs.length > 0 && runs.length === k && runs.every((x) => x.passed && !x.error);
const indicators = (runs) => runs.flatMap((x) => (x.graders || []).filter((g) => g.withOnly || g.scored === false));
const lines = [`# ${title}`, '', header(` · ${k} run(s) per case per arm`), ''];
lines.push(`| Case | With: mean | With: pass^${k} | Without: mean | Without: pass^${k} | Δ mean | Cost with $ | Cost without $ | With-only indicators | Failed graders (with / without) |`, '|---|---|---|---|---|---|---|---|---|---|');
const sum = { with: { means: [], passK: 0, runs: 0, passed: 0, cost: 0, turns: [], errors: 0 }, without: { means: [], passK: 0, runs: 0, passed: 0, cost: 0, turns: [], errors: 0 } };
const ind = [];
for (const c of cases) {
  const cell = {};
  for (const a of ['with', 'without']) {
    const runs = arm(c, a);
    const m = mean(runs.map((x) => x.score || 0));
    const s = sum[a];
    if (runs.length) s.means.push(m);
    if (passK(runs)) s.passK++;
    s.runs += runs.length; s.passed += runs.filter((x) => x.passed && !x.error).length;
    s.cost += runs.reduce((t, x) => t + cost(x), 0);
    s.turns.push(...runs.map((x) => x.turns || 0));
    s.errors += runs.filter((x) => x.error).length;
    const fails = new Map();
    for (const x of runs) for (const f of x.error ? [`ERROR: ${String(x.error).slice(0, 60)}`] : failedOf(x).map((f) => f.split(':')[0])) fails.set(f, (fails.get(f) || 0) + 1);
    cell[a] = { runs, m, pk: passK(runs), cost: runs.reduce((t, x) => t + cost(x), 0), fails: [...fails].map(([f, n]) => `${f} ×${n}`).join(', ') || '—' };
  }
  const gi = indicators(cell.with.runs);
  ind.push(...gi);
  const delta = cell.with.runs.length && cell.without.runs.length ? cell.with.m - cell.without.m : NaN;
  lines.push(`| ${c.name} | ${fmt(cell.with.m)} (${cell.with.runs.length}) | ${cell.with.pk ? '✅' : '❌'} | ${fmt(cell.without.m)} (${cell.without.runs.length}) | ${cell.without.pk ? '✅' : '❌'} | ${Number.isFinite(delta) ? (delta > 0 ? '+' : '') + fmt(delta) : '-'} | ${fmt(cell.with.cost)} | ${fmt(cell.without.cost)} | ${gi.length ? `${gi.filter((g) => g.passed).length}/${gi.length}` : '—'} | ${cell.with.fails} / ${cell.without.fails} |`);
}
lines.push('', 'Mean = mean runner score over that arm\'s runs (with-only graders excluded from the score). pass^k = every run of the case passed. Δ = with − without.', '');
lines.push('## Per arm', '| Metric | With plugin | Without (plain Claude Code) |', '|---|---|---|');
const both = (f) => `| ${f[0]} | ${f[1](sum.with)} | ${f[1](sum.without)} |`;
for (const f of [
  ['Mean of case means', (s) => fmt(mean(s.means))],
  [`Cases passing all ${k} runs (pass^${k})`, (s) => `${s.passK}/${cases.length}`],
  ['Runs passed (pass@1)', (s) => `${s.passed}/${s.runs}`],
  ['Mean turns (orchestrator)', (s) => fmt(mean(s.turns), 1)],
  ['Cost, agent + judges', (s) => `$${fmt(s.cost)}`],
  ['Cost per run', (s) => `$${fmt(s.cost / (s.runs || 1))}`],
  ['Errored runs', (s) => String(s.errors)],
]) lines.push(both(f));
lines.push(`| Mean Δ (runner aggregate) | ${fmt(r.aggregates?.meanDelta)} | — |`);
lines.push(`| With-only indicators passed | ${ind.length ? `${ind.filter((g) => g.passed).length}/${ind.length}` : '—'} | not applicable |`);
lines.push('', `Total cost reported by the runner: $${fmt(r.costUsd)} · wall time ${r.durationSeconds ?? '?'} s.`);
console.log(lines.join('\n'));
