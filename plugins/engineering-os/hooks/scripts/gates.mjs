// Completion-gate evaluation, shared by the Stop hook (stop-verify.mjs) and the status report (eng-status.mjs).
// Everything is derived from files the OS owns: git state, docs/engineering/status.md (Now), the registry,
// .eng/evidence/verify-latest.json, and the gate ledger .eng/evidence/gates.jsonl.
// Freshness is by content fingerprint (see lib.mjs); evidence written by V2 (no fingerprint) falls back to mtime.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NON_SOURCE, TEST_FILE, sourceFingerprint, pluginRoot } from './lib.mjs';
import { parseYaml } from '../../scripts/lib/yaml-lite.mjs';
import { parsePlan, checkPlan } from '../../scripts/eng-plan-check.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const IN_FLIGHT = ['READY', 'RUNNING', 'REVIEW', 'VERIFICATION'];

// "## Now" section of status.md, plus the declarations the gates read from it.
export function readNow(dir) {
  const status = readText(join(dir, 'docs', 'engineering', 'status.md'));
  const now = status.split(/^## /m).find((s) => s.startsWith('Now')) || '';
  const cls = (now.match(/Class:\s*\**\s*(TRIVIAL|SMALL|MEDIUM|LARGE|CRITICAL)\b/) || [])[1] || null;
  const risk = (now.match(/Risk:\s*\**\s*(low|medium|high|critical)\b/i) || [])[1]?.toLowerCase() || null;
  // "Flags: auth, ui" · "Flags: none (docs only)" → parenthetical notes and "none" are not flags.
  const flags = ((now.match(/Flags:\s*([^\n·]*)/) || [])[1] || '').replace(/\([^)]*\)?/g, ' ').split(/[,\s]+/)
    .map((f) => f.trim().toLowerCase()).filter((f) => /^[a-z][a-z-]*$/.test(f) && f !== 'none');
  const pairs = (label) => {
    const out = new Map();
    for (const line of now.split('\n').filter((l) => new RegExp(`${label}:`, 'i').test(l)))
      for (const m of line.matchAll(/([a-z][\w-]*)\s*\(([^)]{3,})\)/gi)) out.set(m[1].toLowerCase(), m[2].trim());
    return out;
  };
  const phase = (now.match(/Phase:\s*([^\n]*)/) || [])[1]?.trim() || null;
  const objective = (now.match(/Objective:\s*([^\n]*)/) || [])[1]?.trim() || null;
  const next = (now.match(/Next actions?:\s*([^\n]*)/) || [])[1]?.trim() || null;
  const blockers = (now.match(/Blockers?:\s*([^\n]*)/) || [])[1]?.trim() || null;
  return { status, now, cls, risk, flags, waived: pairs('Waived'), skipped: pairs('Skipped'), phase, objective, next, blockers };
}

// AC-n lines that are real criteria, not template placeholders ("Given __, when __", "<...>").
export function hasAcceptanceCriteria(dir, statusText) {
  const req = readText(join(dir, 'docs', 'engineering', 'requirements.md'));
  return `${statusText}\n${req}`.split('\n').some((l) => /\bAC-\d+\b[\s:|.)-]+\S.{6,}/.test(l) && !/__|<[^>]+>/.test(l));
}

export function readLedger(dir) {
  return readText(join(dir, '.eng', 'evidence', 'gates.jsonl')).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function loadRegistryFromPlugin() {
  return parseYaml(readFileSync(join(pluginRoot(), 'routing', 'capabilities.yaml'), 'utf8'));
}

// Source files changed this session: working tree + commits since the session's starting HEAD.
export function changedSource(dir, sessionId) {
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const changed = new Set(git('status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()));
  const sid = String(sessionId || '').replace(/[^\w-]/g, '');
  const start = sid ? readJson(join(dir, '.eng', 'state', `session-${sid}.json`)) : null;
  if (start?.head) {
    try { for (const f of git('diff', '--name-only', start.head, 'HEAD').split('\n').filter(Boolean)) changed.add(f); } catch {}
  }
  return [...changed].filter((f) => !NON_SOURCE.test(f));
}

export function evaluateGates(dir, { sessionId, registry } = {}) {
  const source = changedSource(dir, sessionId);
  const result = { applies: source.length > 0, source, missing: [], reviewers: [], verification: null, implied: [], fingerprint: null };
  if (!result.applies) return result;
  const add = (key, msg) => result.missing.push({ key, msg });
  const fp = sourceFingerprint(dir);
  result.fingerprint = fp;
  const latest = Math.max(...source.map((f) => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } }));
  // Fingerprint when both sides have one; otherwise (V2 evidence, or no git) the V2 time rule:
  // evidence file mtime ≥ latest change, ledger entries within 1 s of it.
  const freshEntry = (e, mtime, slackMs = 0) => (fp && e?.fingerprint ? e.fingerprint === fp : (mtime ?? e?.at ?? 0) >= latest - slackMs);

  // 1. Verification at the current content, with consistent evidence.
  const evidencePath = join(dir, '.eng', 'evidence', 'verify-latest.json');
  const verify = readJson(evidencePath);
  const vFresh = Boolean(verify?.verdict) && freshEntry(verify, existsSync(evidencePath) ? statSync(evidencePath).mtimeMs : 0);
  result.verification = verify ? { verdict: verify.verdict, at: verify.timestamp || verify.at, fresh: vFresh } : null;
  if (!vFresh) add('verification', 'verification: run /engineering-os:eng-verify (no evidence for the current content)');
  else if (verify.evidence) {
    const summary = readJson(join(dir, verify.evidence, 'summary.json'));
    if (!summary || summary.fingerprint !== verify.fingerprint || summary.verdict !== verify.verdict)
      add('evidence-integrity', `verification evidence is inconsistent (${verify.evidence}/summary.json missing or different): re-run /engineering-os:eng-verify`);
  }

  // 2. Classification declared.
  const now = readNow(dir);
  const { cls, flags, waived, skipped } = now;
  if (!cls) { add('classification', 'classification: record `Class:` and `Flags:` in docs/engineering/status.md Now (/engineering-os:eng-intake); review gates are derived from it'); return result; }
  const reg = registry || loadRegistryFromPlugin();
  const declared = flags.filter((f) => reg.risk_requirements?.[f]);

  // 3. Class fits the diff (PROC-13).
  const impl = source.filter((f) => !TEST_FILE.test(f));
  const b = reg.budgets?.[cls];
  if (b?.max_impl_files) {
    const areas = new Set(impl.map((f) => (f.includes('/') ? f.split('/')[0] : '.')));
    if (impl.length > b.max_impl_files || areas.size > b.max_areas)
      add('class-size', `reclassify: ${impl.length} non-test source file(s) in ${areas.size} area(s) (${[...areas].join(', ')}) exceed ${cls} (≤${b.max_impl_files} files, ≤${b.max_areas} area); set a higher Class in status.md Now and run its gates`);
  }
  if (cls === 'TRIVIAL' && declared.length) add('class-flags', `reclassify: TRIVIAL work cannot carry risk flags (${declared.join(', ')}); use SMALL or higher`);

  // 4. Risk flags fit the changed paths (and new dependencies).
  const implied = new Map();
  for (const [flag, re] of Object.entries(reg.risk_paths || {})) {
    const rx = new RegExp(re, 'i');
    const hit = impl.find((f) => rx.test(f));
    if (hit) implied.set(flag, hit);
  }
  const newDeps = vFresh ? verify?.signals?.newDependencies || [] : [];
  if (newDeps.length) implied.set('new-dependency', newDeps.slice(0, 3).join(', '));
  result.implied = [...implied.keys()];
  const undeclared = [...implied].filter(([f]) => !declared.includes(f) && !waived.has(f));
  if (undeclared.length)
    add('risk-flags', `risk flags: the change implies ${undeclared.map(([f, why]) => `\`${f}\` (${why})`).join(', ')}; add to Flags: in status.md Now (that adds its reviewers) or record \`Waived: <flag> (<reason>)\``);

  // 5. Lifecycle gates by class (registry `gates`), skippable only with a recorded reason.
  const gateOn = (g) => (reg.gates?.[g] || []).includes(cls) && !skipped.has(g);
  if (gateOn('acceptance_criteria') && !hasAcceptanceCriteria(dir, now.status))
    add('acceptance_criteria', 'acceptance criteria: record testable `AC-n` lines in status.md or requirements.md (or `Skipped: acceptance_criteria (<reason>)`)');
  if (gateOn('plan_complete')) {
    const planText = readText(join(dir, 'docs', 'engineering', 'implementation-plan.md'));
    const parsed = planText ? parsePlan(planText) : { error: 'missing' };
    if (parsed.error) add('plan_complete', `plan: docs/engineering/implementation-plan.md ${parsed.error === 'missing' ? 'is missing' : `is invalid (${parsed.error})`}; /engineering-os:eng-plan (or \`Skipped: plan_complete (<reason>)\`)`);
    else {
      const chk = checkPlan(parsed.tasks, reg.capabilities.map((c) => c.id), { registry: reg, root: dir, cls });
      const open = parsed.tasks.filter((t) => IN_FLIGHT.includes(t.state)).map((t) => `${t.id}=${t.state}`);
      if (chk.errors.length) add('plan_complete', `plan: eng-plan-check reports ${chk.errors.length} error(s), e.g. ${chk.errors[0]}`);
      else if (open.length) add('plan_complete', `plan: tasks still in flight (${open.slice(0, 5).join(', ')}); finish them, or mark BLOCKED/FAILED with a reason`);
    }
  }

  // 6. Required reviewers at the current content (registry budgets + flag reviewers with reviewer_gate).
  if (cls !== 'TRIVIAL') {
    const byId = new Map(reg.capabilities.map((c) => [c.id, c]));
    const capIds = new Set(b?.reviewers || []);
    for (const f of declared) for (const id of reg.risk_requirements[f]) if (byId.get(id)?.reviewer_gate) capIds.add(id);
    const byAgent = new Map();
    for (const id of capIds) { const c = byId.get(id); if (c && !byAgent.has(c.agent)) byAgent.set(c.agent, c.skill || c.agent); }
    const ledger = readLedger(dir);
    for (const [agent, skill] of byAgent) {
      const entries = ledger.filter((g) => g.agent === agent).sort((x, y) => (y.at || 0) - (x.at || 0));
      const current = entries.filter((g) => freshEntry(g, g.at, 1000));
      const top = current[0];
      const state = top ? top.status : entries.length ? 'STALE' : 'MISSING';
      result.reviewers.push({ agent, skill, state });
      if (!top) add('review', `${agent} review (required for ${cls}${declared.length ? ` + ${declared.join(',')}` : ''})${entries.length ? ' is stale (content changed since)' : ''}: run /engineering-os:${skill}`);
      else if (top.status !== 'PASS') add('review', `${agent} returned ${top.status}: fix the findings and re-run /engineering-os:${skill}`);
    }
  }
  return result;
}
