#!/usr/bin/env node
// Deterministic staffing router: request + scope/risk/flags -> class, budget, candidate capabilities, mandatory reviewers.
// Usage: node eng-route.mjs --request "add login to the API" --scope small --risk high --flags auth,external-input [--json]
// The orchestrator still decides; this keeps staffing consistent and avoids reading the whole registry.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './lib/yaml-lite.mjs';

const SCOPES = ['trivial', 'small', 'medium', 'large'];
const RISKS = ['low', 'medium', 'high', 'critical'];
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

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (text, trigger) => new RegExp(`(^|[^a-z0-9])${escape(trigger.toLowerCase())}($|[^a-z0-9])`).test(text);

export function route({ request = '', scope, risk, flags = [] }, registry = loadRegistry()) {
  const cls = classify(scope, risk);
  const budget = registry.budgets[cls];
  const text = request.toLowerCase();
  const byId = new Map(registry.capabilities.map((c) => [c.id, c]));
  const unknownFlags = flags.filter((f) => !registry.risk_requirements[f]);
  if (unknownFlags.length) throw new Error(`unknown risk flag(s): ${unknownFlags.join(', ')}; known: ${Object.keys(registry.risk_requirements).join(', ')}`);

  const candidates = registry.capabilities
    .map((c) => ({ c, hits: c.triggers.filter((t) => matches(text, t)) }))
    .filter(({ c, hits }) => hits.length && c.classes.includes(cls) && !['code-review', 'scope-judge'].includes(c.id))
    .sort((a, b) => b.hits.length - a.hits.length);

  const required = new Map();
  for (const f of flags) for (const id of registry.risk_requirements[f]) if (!required.has(id)) required.set(id, f);
  const reviewers = [...new Set([...budget.reviewers, ...[...required.keys()].filter((id) => ['appsec', 'supply-chain', 'privacy'].includes(id))])];

  // Staffing policy: TRIVIAL = main session only; SMALL = at most one specialist.
  let staffed = cls === 'TRIVIAL' ? [] : candidates.map(({ c, hits }) => ({ id: c.id, agent: c.agent, model: c.model, max_turns: c.max_turns, parallel: c.parallel, why: hits.join(', ') }));
  for (const [id, flag] of required) {
    if (reviewers.includes(id) || staffed.some((s) => s.id === id)) continue;
    const c = byId.get(id);
    staffed.push({ id, agent: c.agent, model: c.model, max_turns: c.max_turns, parallel: c.parallel, why: `risk:${flag}` });
  }
  if (cls === 'SMALL') staffed = staffed.slice(0, 1);
  const agentsNeeded = new Set(staffed.map((s) => s.agent)).size;
  return {
    class: cls,
    budget,
    staffed: staffed.slice(0, Math.max(0, budget.max_agents)),
    overBudget: agentsNeeded > budget.max_agents,
    reviewers: cls === 'TRIVIAL' ? [] : reviewers.map((id) => ({ id, agent: byId.get(id)?.agent ?? id })),
    mandatory: [...required.entries()].map(([id, flag]) => `${id} (risk:${flag})`),
    deliverables: flags.map((f) => ({ flag: f, evidence: registry.risk_deliverables?.[f] || '' })),
  };
}

function cli(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  const r = route({ request: arg('request', ''), scope: arg('scope', 'small'), risk: arg('risk', 'low'), flags: (arg('flags', '') || '').split(',').filter(Boolean) });
  if (argv.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  const b = r.budget;
  console.log(`CLASS: ${r.class}`);
  console.log(`BUDGET: max_agents=${b.max_agents} concurrency=${b.concurrency} research=${b.research} retries/approach=${b.retries} verify=${b.verify}`);
  console.log(`STAFF: ${r.staffed.length ? r.staffed.map((s) => `${s.id}→engineering-os:${s.agent} (${s.model}, ${s.max_turns}t; ${s.why})`).join(' | ') : 'main session only'}`);
  console.log(`REVIEWERS: ${r.reviewers.map((x) => `${x.id}→engineering-os:${x.agent}`).join(', ') || 'self-check diff'}`);
  if (r.mandatory.length) console.log(`MANDATORY (risk): ${r.mandatory.join(', ')}`);
  for (const d of r.deliverables) console.log(`DELIVERABLE (${d.flag}): ${d.evidence}`);
  if (r.overBudget) console.log('NOTE: candidates exceed the class budget; staff the highest-value ones or reclassify with evidence.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { cli(process.argv.slice(2)); } catch (e) { console.error(`eng-route: ${e.message}`); process.exit(2); }
}
