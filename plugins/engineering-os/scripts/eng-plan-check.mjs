#!/usr/bin/env node
// Validates the task DAG in docs/engineering/implementation-plan.md and prints the dispatchable frontier.
// Checks: unique IDs, known deps, no cycles, deps in earlier waves, valid states/capabilities,
// disjoint file scopes within a wave, and state consistency (nothing RUNNING/DONE before its deps are DONE).
// Usage: node eng-plan-check.mjs [planPath] [--json]   Exit 1 on errors.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './eng-route.mjs';

export const STATES = ['READY', 'RUNNING', 'BLOCKED', 'REVIEW', 'VERIFICATION', 'DONE', 'FAILED'];
const REQUIRED = ['id', 'objective', 'capability', 'depends', 'wave', 'files', 'verifier', 'state'];

export function parsePlan(text) {
  const rows = text.split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  const headerIdx = rows.findIndex((l) => /\|\s*ID\s*\|/i.test(l));
  if (headerIdx < 0) return { error: 'no task table with an "ID" column found' };
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const header = cells(rows[headerIdx]).map((h) => h.toLowerCase());
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length) return { error: `task table missing column(s): ${missing.join(', ')}` };
  const tasks = [];
  for (const l of rows.slice(headerIdx + 1)) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
    const c = cells(l);
    if (!/^T-/.test(c[0] || '')) break;
    const t = Object.fromEntries(header.map((h, i) => [h, c[i] ?? '']));
    t.depends = t.depends.split(/[,\s]+/).filter((d) => /^T-/.test(d));
    t.files = t.files.replace(/`/g, '').split(/[,\s]+/).filter(Boolean);
    t.wave = Number(t.wave);
    t.state = t.state.replace(/[`*]/g, '').toUpperCase();
    tasks.push(t);
  }
  return { tasks };
}

const prefix = (glob) => glob.split(/[*?{[]/)[0].replace(/\/+$/, '');
const overlap = (a, b) => {
  const pa = prefix(a);
  const pb = prefix(b);
  if (!pa || !pb) return true; // "**" or similar touches everything
  return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
};

export function checkPlan(tasks, capabilityIds = null) {
  const errors = [];
  const warnings = [];
  const byId = new Map();
  for (const t of tasks) {
    if (!/^T-\d+$/.test(t.id)) errors.push(`${t.id}: id must look like T-<n>`);
    if (byId.has(t.id)) errors.push(`${t.id}: duplicate id`);
    byId.set(t.id, t);
    if (!STATES.includes(t.state)) errors.push(`${t.id}: state "${t.state}" not in ${STATES.join('|')}`);
    if (!Number.isInteger(t.wave) || t.wave < 1) errors.push(`${t.id}: wave must be a positive integer`);
    if (capabilityIds && !capabilityIds.includes(t.capability) && t.capability !== 'orchestrator') errors.push(`${t.id}: unknown capability "${t.capability}"`);
    if (!t.files.length) errors.push(`${t.id}: files scope is empty`);
    if (!t.verifier || t.verifier === '-') errors.push(`${t.id}: verifier missing (every task must be independently verifiable)`);
  }
  for (const t of tasks) {
    for (const d of t.depends) {
      const dep = byId.get(d);
      if (!dep) { errors.push(`${t.id}: depends on unknown ${d}`); continue; }
      if (dep.wave >= t.wave) errors.push(`${t.id}: depends on ${d} in wave ${dep.wave}; must be an earlier wave than ${t.wave}`);
      if (['RUNNING', 'REVIEW', 'VERIFICATION', 'DONE'].includes(t.state) && dep.state !== 'DONE') errors.push(`${t.id}: is ${t.state} but dependency ${d} is ${dep.state}`);
    }
  }
  const visiting = new Set();
  const done = new Set();
  const visit = (id, path) => {
    if (done.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) { errors.push(`cycle: ${[...path, id].join(' → ')}`); return; }
    visiting.add(id);
    for (const d of byId.get(id).depends) visit(d, [...path, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const t of tasks) visit(t.id, []);
  const waves = new Map();
  for (const t of tasks) waves.set(t.wave, [...(waves.get(t.wave) || []), t]);
  for (const [w, ts] of waves)
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++)
        for (const fa of ts[i].files) for (const fb of ts[j].files)
          if (overlap(fa, fb)) errors.push(`wave ${w}: ${ts[i].id} and ${ts[j].id} share file scope (${fa} ~ ${fb}); run them in different waves or split the files`);
  const frontier = tasks.filter((t) => t.state === 'READY' && t.depends.every((d) => byId.get(d)?.state === 'DONE'));
  const failed = tasks.filter((t) => t.state === 'FAILED');
  if (failed.length) warnings.push(`FAILED tasks need a new approach or escalation: ${failed.map((t) => t.id).join(', ')}`);
  return { errors: [...new Set(errors)], warnings, frontier: frontier.map((t) => t.id), counts: Object.fromEntries(STATES.map((s) => [s, tasks.filter((t) => t.state === s).length])) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--')) || join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'docs', 'engineering', 'implementation-plan.md');
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { console.error(`eng-plan-check: cannot read ${path}`); process.exit(2); }
  const parsed = parsePlan(text);
  if (parsed.error) { console.log(`PLAN: FAIL → ${parsed.error}`); process.exit(1); }
  let ids = null;
  try { ids = loadRegistry().capabilities.map((c) => c.id); } catch {}
  const r = checkPlan(parsed.tasks, ids);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`PLAN: ${r.errors.length ? 'FAIL' : 'PASS'} · ${parsed.tasks.length} tasks · ${Object.entries(r.counts).filter(([, n]) => n).map(([s, n]) => `${s}=${n}`).join(' ')}`);
    for (const e of r.errors) console.log(`  ERROR ${e}`);
    for (const w of r.warnings) console.log(`  WARN ${w}`);
    console.log(`READY NOW: ${r.frontier.join(', ') || 'none'}`);
  }
  process.exit(r.errors.length ? 1 : 0);
}
