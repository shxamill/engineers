#!/usr/bin/env node
// Deterministic staffing router: request + scope + risk dimensions/flags -> class, budget, staff, reviewers,
// mandatory capabilities, deliverables, and lifecycle gates. Reads only routing/capabilities.yaml.
// Usage: node eng-route.mjs --request "add login to the API" --scope small
//          [--dims security-sensitivity=high,data-sensitivity=medium | --risk high] [--flags auth,external-input]
//          [--json] [--no-log]
// The orchestrator still decides; this keeps staffing consistent, records the decision, and avoids reading
// the whole registry.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './lib/yaml-lite.mjs';
import { logEvent } from '../hooks/scripts/lib.mjs';

const SCOPES = ['trivial', 'small', 'medium', 'large'];
export const RISKS = ['low', 'medium', 'high', 'critical'];
const CLASS_OF_SCOPE = { trivial: 'TRIVIAL', small: 'SMALL', medium: 'MEDIUM', large: 'LARGE' };

export function loadRegistry(path = fileURLToPath(new URL('../routing/capabilities.yaml', import.meta.url))) {
  return parseYaml(readFileSync(path, 'utf8'));
}

// Class = scope class; critical risk => CRITICAL; high risk never stays TRIVIAL. Risk adds gates, not headcount.
export function classify(scope, risk) {
  if (!SCOPES.includes(scope)) throw new Error(`--scope must be one of ${SCOPES.join('|')}`);
  if (!RISKS.includes(risk)) throw new Error(`--risk must be one of ${RISKS.join('|')}`);
  if (risk === 'critical') return 'CRITICAL';
  if (risk === 'high' && scope === 'trivial') return 'SMALL';
  return CLASS_OF_SCOPE[scope];
}

// Risk from per-dimension scores: the highest score wins; a declared --risk below it is an understatement.
export function riskFromDims(dims, declared, registry) {
  const known = registry.risk_dimensions || [];
  const unknown = Object.keys(dims).filter((d) => !known.includes(d));
  if (unknown.length) throw new Error(`unknown risk dimension(s): ${unknown.join(', ')}; known: ${known.join(', ')}`);
  const bad = Object.entries(dims).filter(([, v]) => !RISKS.includes(v));
  if (bad.length) throw new Error(`dimension level must be one of ${RISKS.join('|')}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const levels = Object.values(dims);
  if (!levels.length) return { risk: declared, drivers: [] };
  const computed = RISKS[Math.max(...levels.map((l) => RISKS.indexOf(l)))];
  if (declared && RISKS.indexOf(declared) < RISKS.indexOf(computed))
    throw new Error(`--risk ${declared} understates the dimension scores (highest: ${computed}); use --risk ${computed} or omit --risk`);
  const risk = declared && RISKS.indexOf(declared) > RISKS.indexOf(computed) ? declared : computed;
  return { risk, drivers: Object.entries(dims).filter(([, v]) => v === computed).map(([k]) => k) };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (text, trigger) => new RegExp(`(^|[^a-z0-9])${escape(trigger.toLowerCase())}($|[^a-z0-9])`).test(text);

export const modelOf = (registry, cap) => registry.tiers?.[cap.tier] ?? cap.tier;

export function route({ request = '', scope, risk, dims = {}, flags = [] }, registry = loadRegistry()) {
  const { risk: finalRisk, drivers } = riskFromDims(dims, risk, registry);
  if (!finalRisk) throw new Error('give --dims (preferred) or --risk');
  const cls = classify(scope, finalRisk);
  const budget = registry.budgets[cls];
  const text = request.toLowerCase();
  const byId = new Map(registry.capabilities.map((c) => [c.id, c]));
  const unknownFlags = flags.filter((f) => !registry.risk_requirements[f]);
  if (unknownFlags.length) throw new Error(`unknown risk flag(s): ${unknownFlags.join(', ')}; known: ${Object.keys(registry.risk_requirements).join(', ')}`);

  const isReviewer = (id) => byId.get(id)?.reviewer_gate === true;
  const required = new Map();
  for (const f of flags) for (const id of registry.risk_requirements[f]) if (!required.has(id)) required.set(id, f);
  const reviewers = [...new Set([...budget.reviewers, ...[...required.keys()].filter(isReviewer)])];

  const entry = (c, why) => ({ id: c.id, agent: c.agent, model: modelOf(registry, c), max_turns: c.max_turns, parallel: c.parallel, why });
  // Staffing policy: required (risk) capabilities first, then trigger matches; reviewers are never staffed
  // as builders, and a capability is staffed only in the classes its registry entry allows (otherwise the
  // orchestrator covers it). TRIVIAL = main session only; the class budget truncates (SMALL = one specialist).
  const staffed = [];
  for (const [id, flag] of required) if (!isReviewer(id) && byId.get(id).classes.includes(cls)) staffed.push(entry(byId.get(id), `risk:${flag}`));
  const candidates = registry.capabilities
    .map((c) => ({ c, hits: c.triggers.filter((t) => matches(text, t)) }))
    .filter(({ c, hits }) => hits.length && c.classes.includes(cls) && !c.reviewer_gate && !required.has(c.id))
    .sort((a, b) => b.hits.length - a.hits.length);
  for (const { c, hits } of candidates) staffed.push(entry(c, hits.join(', ')));
  const limit = cls === 'TRIVIAL' ? 0 : Math.max(0, cls === 'SMALL' ? Math.min(1, budget.max_agents) : budget.max_agents);
  const team = staffed.slice(0, limit);
  const agentsNeeded = new Set(staffed.map((s) => s.agent)).size;
  const gates = Object.entries(registry.gates || {}).filter(([, classes]) => classes.includes(cls)).map(([g]) => g);
  return {
    class: cls,
    risk: finalRisk,
    drivers,
    budget,
    staffed: team,
    overBudget: agentsNeeded > budget.max_agents || (cls === 'SMALL' && staffed.length > 1),
    reviewers: cls === 'TRIVIAL' ? [] : reviewers.map((id) => ({ id, agent: byId.get(id)?.agent ?? id, skill: byId.get(id)?.skill })),
    mandatory: [...required.entries()].map(([id, flag]) => `${id} (risk:${flag})`),
    uncovered: [...required.entries()].filter(([id]) => !isReviewer(id) && !team.some((s) => s.id === id)).map(([id]) => id),
    deliverables: flags.map((f) => ({ flag: f, evidence: registry.risk_deliverables?.[f] || '' })),
    gates,
  };
}

const parseDims = (s) => Object.fromEntries((s || '').split(',').filter(Boolean).map((kv) => {
  const [k, v] = kv.split('=').map((x) => x.trim());
  return [k, (v || '').toLowerCase()];
}));

function cli(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  const flags = (arg('flags', '') || '').split(',').filter(Boolean);
  const dims = parseDims(arg('dims', ''));
  const r = route({ request: arg('request', ''), scope: arg('scope', 'small'), risk: arg('risk'), dims, flags });
  if (!argv.includes('--no-log'))
    logEvent(process.env.CLAUDE_PROJECT_DIR || process.cwd(), { event: 'route', class: r.class, risk: r.risk, dims, flags, staffed: r.staffed.map((s) => s.id), reviewers: r.reviewers.map((x) => x.id) });
  if (argv.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  const b = r.budget;
  console.log(`CLASS: ${r.class} · RISK: ${r.risk}${r.drivers.length ? ` (from ${r.drivers.join(', ')})` : ''}`);
  console.log(`BUDGET: max_agents=${b.max_agents} concurrency=${b.concurrency} research=${b.research} retries/approach=${b.retries} verify=${b.verify}`);
  console.log(`STAFF: ${r.staffed.length ? r.staffed.map((s) => `${s.id}→engineering-os:${s.agent} (${s.model}, ${s.max_turns}t; ${s.why})`).join(' | ') : 'main session only'}`);
  console.log(`REVIEWERS: ${r.reviewers.map((x) => `${x.id}→/engineering-os:${x.skill || x.agent}`).join(', ') || 'self-check diff'}`);
  if (r.mandatory.length) console.log(`MANDATORY (risk): ${r.mandatory.join(', ')}`);
  if (r.uncovered.length) console.log(`UNCOVERED BY BUDGET: ${r.uncovered.join(', ')} — cover it yourself or report it unmet`);
  for (const d of r.deliverables) console.log(`DELIVERABLE (${d.flag}): ${d.evidence}`);
  if (r.gates.length) console.log(`GATES: ${r.gates.join(', ')} (skip only with "Skipped: <gate> (<reason>)" in status.md Now)`);
  if (r.overBudget) console.log('NOTE: candidates exceed the class budget; staff the highest-value ones or reclassify with evidence.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { cli(process.argv.slice(2)); } catch (e) { console.error(`eng-route: ${e.message}`); process.exit(2); }
}
