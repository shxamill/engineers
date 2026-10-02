#!/usr/bin/env node
// Release readiness checker (F12/F14): validates docs/engineering/release-plan.md deterministically.
//  - readiness: every row of the "Readiness checklist" table is PASS (with evidence) or N/A (with a reason)
//  - production target: "Human approval:" names who approved and when (not the template placeholder)
//  - --stage post-deploy: every "Post-deploy verification" row has an Actual value and none FAILED
//  - --env A,B: reports each variable as PRESENT or MISSING from the process environment or .env files,
//    never printing a value (secrets stay out of the transcript)
// Usage: node eng-release-check.mjs [planPath] [--stage readiness|post-deploy] [--target <env>] [--env A,B] [--json]
// Exit 0 = READY, 1 = NOT_READY, 2 = usage error.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const placeholder = (v) => !v || /^<[^>]*>$|^[-–—]?$|__/.test(v.trim());

// Rows of the first table after a heading that matches `title`.
export function tableAfter(text, title) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#+\s/.test(l) && title.test(l));
  if (start < 0) return null;
  const rows = [];
  let header = null;
  for (const l of lines.slice(start + 1)) {
    if (/^#+\s/.test(l)) break;
    if (!/^\s*\|/.test(l)) { if (header) break; continue; }
    if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
    const c = cells(l);
    if (!header) { header = c.map((h) => h.toLowerCase()); continue; }
    rows.push(Object.fromEntries(header.map((h, i) => [h, c[i] ?? ''])));
  }
  return rows;
}

// Names only: process env first, then KEY= lines of real .env files in the project root.
export function envPresence(root, names) {
  const fromFiles = new Map();
  let files = [];
  try { files = readdirSync(root).filter((f) => /^\.env(\.[\w.-]+)?$/.test(f) && !/\.(example|sample|template|dist|defaults|schema)$/.test(f)); } catch {}
  for (const f of files) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)$/);
        if (m && m[2].replace(/^["']|["']$/g, '').trim()) fromFiles.set(m[1], f);
      }
    } catch {}
  }
  return names.map((n) => ({ name: n, status: process.env[n] ? 'PRESENT' : fromFiles.has(n) ? 'PRESENT' : 'MISSING', source: process.env[n] ? 'environment' : fromFiles.get(n) || null }));
}

export function checkRelease(text, { stage = 'readiness', target } = {}) {
  const gaps = [];
  const title = (text.match(/^#\s*Release Plan\s*[—-]\s*([^\n]*)/m) || [])[1] || '';
  const tgt = (target || (title.match(/→\s*([\w-]+)/) || [])[1] || '').toLowerCase();
  const readiness = tableAfter(text, /readiness/i);
  if (!readiness?.length) gaps.push('no "Readiness checklist" table found');
  else for (const r of readiness) {
    const status = (r.status || '').toUpperCase().replace(/[`*]/g, '');
    const item = r.item || '?';
    if (status === 'PASS') { if (placeholder(r.evidence)) gaps.push(`${item}: PASS without evidence`); }
    else if (status === 'N/A' || status === 'NA' || status === 'NOT_APPLICABLE') { if (placeholder(r.evidence)) gaps.push(`${item}: N/A needs a reason in Evidence`); }
    else gaps.push(`${item}: status "${r.status || 'empty'}" (needs PASS with evidence, or N/A with a reason)`);
  }
  const approval = (text.match(/Human approval:\s*([^·\n_]*)/) || [])[1]?.trim() || '';
  // A named approval, not a status word: "TBD", "pending", "none", "n/a", "required for production" don't count.
  const unnamed = /^(tbd|tba|todo|pending|none|n\/?a|no|not yet|unknown|required( for production)?|awaiting\b.*|to be (confirmed|decided)|\?+)\.?$|^(tbd|tba|todo|pending|awaiting|not approved|not yet|unapproved)\b/i;
  if (/prod/.test(tgt) && (placeholder(approval) || unnamed.test(approval) || /required for production/i.test(approval)))
    gaps.push('production release without a named human approval ("Human approval: <who>, <when>")');
  if (stage === 'post-deploy') {
    const post = tableAfter(text, /post-deploy/i);
    if (!post?.length) gaps.push('no "Post-deploy verification" table found');
    else for (const r of post) {
      if (placeholder(r.actual)) gaps.push(`post-deploy ${r.check || '?'}: no Actual value`);
      // A failing actual: an explicit FAIL/FAILED/DOWN/REGRESSED verdict (not the word "errors" in "errors flat").
      else if (/^\s*(fail(ed)?|down|regress(ed)?)\b|\b(fail(ed)?|regress(ed)?|breach(ed)?)\s*[:(—-]|[(—-]\s*(fail(ed)?|regress(ed)?)\b|\bregressed\b|\bFAIL\b/i.test(r.actual))
        gaps.push(`post-deploy ${r.check || '?'}: ${r.actual}`);
    }
  }
  return { ready: gaps.length === 0, target: tgt || null, stage, rows: readiness?.length || 0, gaps };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const VALUED = ['--stage', '--target', '--env'];
  const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const path = positional[0] || join(root, 'docs', 'engineering', 'release-plan.md');
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { console.error(`eng-release-check: cannot read ${path}`); process.exit(2); }
  const r = checkRelease(text, { stage: val('stage') || 'readiness', target: val('target') });
  const env = val('env') ? envPresence(positional[0] ? resolve(dirname(resolve(path)), '..', '..') : root, val('env').split(',').filter(Boolean)) : [];
  const missingEnv = env.filter((e) => e.status === 'MISSING');
  if (missingEnv.length) r.gaps.push(`missing configuration: ${missingEnv.map((e) => e.name).join(', ')}`);
  r.ready = r.gaps.length === 0;
  if (args.includes('--json')) console.log(JSON.stringify({ ...r, env }, null, 2));
  else {
    console.log(`RELEASE: ${r.ready ? 'READY' : 'NOT_READY'} · target=${r.target || '?'} · stage=${r.stage} · readiness rows=${r.rows}`);
    for (const g of r.gaps) console.log(`  GAP ${g}`);
    if (env.length) console.log(`ENV: ${env.map((e) => `${e.name}=${e.status}`).join(' ')}`);
  }
  process.exit(r.ready ? 0 : 1);
}
