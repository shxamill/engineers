#!/usr/bin/env node
// Deterministic status report for the Engineering OS (no model calls): project, class/risk/phase, plan,
// active agents, verification freshness, required reviews, security, release, outcome, last gate result,
// and cost/telemetry counters. Gate evaluation is shared with the Stop hook (hooks/scripts/gates.mjs).
// Usage: node eng-status.mjs [projectDir] [--metrics] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { evaluateGates, readNow } from '../hooks/scripts/gates.mjs';
import { parsePlan, checkPlan } from './eng-plan-check.mjs';
import { checkRelease } from './eng-release-check.mjs';
import { loadRegistry } from './eng-route.mjs';

const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function readTelemetry(dir) {
  return readText(join(dir, '.eng', 'telemetry.jsonl')).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Counters over telemetry events (diagnostic, never targets — research ORG-8).
export function metrics(events) {
  const by = (e) => events.filter((x) => x.event === e);
  const routes = by('route');
  const spawns = by('spawn');
  const handoffs = by('handoff');
  const verifies = by('verify');
  const gates = by('gate');
  const guards = by('guard');
  const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const closed = new Set(handoffs.filter((h) => h.accepted).map((h) => h.agent_id).filter(Boolean));
  return {
    requests: routes.length,
    classes: count(routes, (r) => r.class),
    agentsSpawned: spawns.length,
    agentsPerRequest: routes.length ? +(spawns.length / routes.length).toFixed(2) : null,
    spawnsByAgent: count(spawns, (s) => s.agent),
    activeAgents: spawns.filter((s) => s.agent_id && !closed.has(s.agent_id)).map((s) => s.agent),
    handoffsRejected: handoffs.filter((h) => !h.accepted).length,
    reviewVerdicts: count(handoffs.filter((h) => h.accepted && ['code-reviewer', 'scope-judge', 'security-engineer', 'adversarial-qa'].includes(h.agent)), (h) => `${h.agent}:${h.status}`),
    verifyRuns: verifies.length,
    verifyFailures: verifies.filter((v) => v.verdict === 'FAIL').length,
    tamperFindings: verifies.reduce((n, v) => n + (v.tamper || 0), 0),
    secretFindings: verifies.reduce((n, v) => n + (v.secrets || 0), 0),
    gateBlocks: gates.filter((g) => g.result === 'block').length,
    gateBlockReasons: count(gates.filter((g) => g.result === 'block').flatMap((g) => (g.missing || []).map((m) => ({ m }))), (x) => x.m),
    lastGate: gates.at(-1) || null,
    guardAsks: guards.filter((g) => g.decision === 'ask').length,
    guardDenies: guards.filter((g) => g.decision === 'deny').length,
  };
}

export function statusReport(dir) {
  const now = readNow(dir);
  const profile = readJson(join(dir, 'docs', 'engineering', 'project-profile.json'));
  let registry = null;
  try { registry = loadRegistry(); } catch {}
  let gates = null;
  try { gates = evaluateGates(dir, { registry }); } catch (e) { gates = { error: e.message }; }
  const planText = readText(join(dir, 'docs', 'engineering', 'implementation-plan.md'));
  let plan = null;
  if (planText) {
    const p = parsePlan(planText);
    plan = p.error ? { error: p.error } : { ...checkPlan(p.tasks, registry?.capabilities.map((c) => c.id) || null, { registry, root: dir, cls: p.cls }), total: p.tasks.length };
  }
  const releaseText = readText(join(dir, 'docs', 'engineering', 'release-plan.md'));
  const release = releaseText ? checkRelease(releaseText) : null;
  const outcomes = readText(join(dir, 'docs', 'engineering', 'outcomes.md')).split('\n').filter((l) => /^\|\s*\d{4}-/.test(l));
  const verify = readJson(join(dir, '.eng', 'evidence', 'verify-latest.json'));
  const m = metrics(readTelemetry(dir));
  let branch = '';
  try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return { now, profile, gates, plan, release, outcome: outcomes.at(-1) || null, verify, metrics: m, branch };
}

function render(r) {
  const n = r.now;
  const L = [];
  const p = r.profile;
  L.push(`PROJECT: ${p ? `${(p.languages || []).join('+') || '?'} · ${p.packageManager || '-'} · checks ${[...new Set((p.checks || []).map((c) => c.kind))].join(',') || 'none'}` : 'no profile (run /engineering-os:eng-init)'} · branch ${r.branch || '?'}`);
  L.push(`OBJECTIVE: ${n.objective || '—'}`);
  L.push(`CLASS: ${n.cls || 'undeclared'} · RISK: ${n.risk || '?'} · FLAGS: ${n.flags.join(', ') || 'none'}${n.waived.size ? ` · WAIVED: ${[...n.waived.keys()].join(', ')}` : ''} · PHASE: ${n.phase || '?'}`);
  if (r.plan) L.push(r.plan.error ? `TASKS: plan invalid (${r.plan.error})` : `TASKS: ${r.plan.total} · ${Object.entries(r.plan.counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ')} · READY NOW: ${r.plan.frontier.join(', ') || 'none'}${r.plan.errors.length ? ` · ${r.plan.errors.length} plan error(s)` : ''}`);
  else L.push('TASKS: no implementation plan');
  L.push(`AGENTS: active ${r.metrics.activeAgents.length ? r.metrics.activeAgents.join(', ') : 'none'} · spawned ${r.metrics.agentsSpawned}${r.metrics.agentsPerRequest !== null ? ` (${r.metrics.agentsPerRequest}/request)` : ''}`);
  L.push(`BLOCKERS: ${n.blockers || 'none recorded'}`);
  const g = r.gates;
  if (g?.error) L.push(`GATES: could not evaluate (${g.error})`);
  else if (!g?.applies) L.push('GATES: no source changes in the working tree');
  else {
    const v = g.verification;
    L.push(`VERIFICATION: ${v ? `${v.verdict} · ${v.fresh ? 'current content' : 'STALE (content changed)'}` : 'none'}`);
    L.push(`REVIEWS: ${g.reviewers.length ? g.reviewers.map((x) => `${x.agent} ${x.state}`).join(' · ') : 'none required'}`);
    L.push(`GATE: ${g.missing.length ? `would BLOCK → ${[...new Set(g.missing.map((x) => x.key))].join(', ')}` : 'would pass'}${g.implied.length ? ` · implied flags: ${g.implied.join(', ')}` : ''}`);
  }
  const sec = r.verify?.lines?.filter((l) => /^(SECRETS|SUPPLY-CHAIN|TESTS-TAMPER):/.test(l)).map((l) => l.split(' →')[0].replace(/ \(.*/, '')) || [];
  L.push(`SECURITY: ${sec.join(' · ') || 'no verification yet'}${n.flags.length ? ` · flags ${n.flags.join(', ')}` : ''}`);
  L.push(`RELEASE: ${r.release ? `${r.release.ready ? 'READY' : `NOT_READY (${r.release.gaps.length} gap(s))`} · target ${r.release.target || '?'}` : 'no release plan'}`);
  L.push(`OUTCOME: ${r.outcome ? r.outcome.split('|').map((c) => c.trim()).filter(Boolean).slice(0, 7).join(' · ') : 'not measured'}`);
  const mm = r.metrics;
  L.push(`COST: requests ${mm.requests} · verify runs ${mm.verifyRuns} (fail ${mm.verifyFailures}) · handoffs rejected ${mm.handoffsRejected} · gate blocks ${mm.gateBlocks} · guard asks ${mm.guardAsks} / denies ${mm.guardDenies}${mm.lastGate ? ` · last stop: ${mm.lastGate.result}` : ''}`);
  L.push(`NEXT: ${n.next || '—'}`);
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!existsSync(dir)) { console.error(`eng-status: no such directory ${dir}`); process.exit(2); }
  const r = statusReport(dir);
  if (args.includes('--json')) console.log(JSON.stringify(r, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
  else if (args.includes('--metrics')) console.log(JSON.stringify(r.metrics, null, 2));
  else console.log(render(r));
}
