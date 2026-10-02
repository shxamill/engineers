// Completion-gate evaluation, shared by the Stop hook (stop-verify.mjs) and the status report (eng-status.mjs).
// Everything is derived from files the OS owns: git state, docs/engineering/status.md (Now), the registry,
// .eng/evidence/verify-latest.json, and the gate ledger .eng/evidence/gates.jsonl.
// Freshness is by content fingerprint (see lib.mjs); entries without one never count in a git repository.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NON_SOURCE, TEST_FILE, LOCKFILE, sourceFingerprint, pluginRoot } from './lib.mjs';
import { parseYaml } from '../../scripts/lib/yaml-lite.mjs';
import { parsePlan, checkPlan } from '../../scripts/eng-plan-check.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const IN_FLIGHT = ['READY', 'RUNNING', 'REVIEW', 'VERIFICATION'];
const LEVEL_RANK = { targeted: 1, standard: 2, full: 3 };
const FUTURE_SLACK_MS = 60_000; // a ledger entry dated later than this is forged or clock-skewed: ignored

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
    // Only a line that starts with the label ("- Waived: auth (…)"); "Not waived: …" is prose, not a waiver.
    for (const line of now.split('\n').filter((l) => new RegExp(`^\\s*[-*]?\\s*${label}:`, 'i').test(l)))
      for (const m of line.matchAll(/([a-z][\w-]*)\s*\(([^)]{3,})\)/gi)) out.set(m[1].toLowerCase(), m[2].trim());
    return out;
  };
  const phase = (now.match(/Phase:\s*([^\n]*)/) || [])[1]?.trim() || null;
  const objective = (now.match(/Objective:\s*([^\n]*)/) || [])[1]?.trim() || null;
  const next = (now.match(/Next actions?:\s*([^\n]*)/) || [])[1]?.trim() || null;
  const blockers = (now.match(/Blockers?:\s*([^\n]*)/) || [])[1]?.trim() || null;
  return { status, now, cls, risk, flags, waived: pairs('Waived'), skipped: pairs('Skipped'), phase, objective, next, blockers };
}

// An AC-n line that is a real criterion: what remains after removing template placeholders ("<…>", "__",
// "Given/when/then", parenthetical notes) still says something.
export const isAcceptanceCriterion = (line) => {
  const m = line.match(/\bAC-\d+\b[\s:|.)-]+(.*)$/);
  if (!m) return false;
  const rest = m[1].replace(/<[^>]*>/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/_{2,}/g, ' ').replace(/\b(given|when|then|and)\b/gi, ' ');
  return (rest.match(/[\p{L}\p{N}]/gu) || []).length >= 6;
};

// Criteria for the current objective: AC lines in status.md Now, or in requirements.md when that file changed in
// this session or Now points to it. Criteria left in requirements.md by an earlier objective don't count.
export function hasAcceptanceCriteria(dir, nowText, changed = []) {
  if (nowText.split('\n').some(isAcceptanceCriterion)) return true;
  const req = 'docs/engineering/requirements.md';
  if (!changed.includes(req) && !/requirements\.md/.test(nowText)) return false;
  return readText(join(dir, req)).split('\n').some(isAcceptanceCriterion);
}

export function readLedger(dir) {
  return readText(join(dir, '.eng', 'evidence', 'gates.jsonl')).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function loadRegistryFromPlugin() {
  return parseYaml(readFileSync(join(pluginRoot(), 'routing', 'capabilities.yaml'), 'utf8'));
}

// Files changed this session: the working tree, commits since the session's starting HEAD, and commits made
// this session on other local branches that the current branch doesn't contain (work left on a side branch).
export function changedFiles(dir, sessionId) {
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const all = new Set();
  const z = git('status', '--porcelain', '-z', '-uall').split('\0');
  for (let i = 0; i < z.length; i++) {
    if (!z[i]) continue;
    all.add(z[i].slice(3));
    if (/[RC]/.test(z[i].slice(0, 2))) i++; // rename/copy: the next entry is the old path
  }
  const branches = [];
  const sid = String(sessionId || '').replace(/[^\w-]/g, '');
  const start = sid ? readJson(join(dir, '.eng', 'state', `session-${sid}.json`)) : null;
  if (/^[0-9a-f]{40}$/.test(start?.head || '')) {
    try { for (const f of git('diff', '--name-only', start.head, 'HEAD').split('\n').filter(Boolean)) all.add(f); } catch {}
    try {
      const since = start.at ? [`--since=@${Math.floor(start.at / 1000) - 1}`] : [];
      for (const b of git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean)) {
        const files = git('log', '--format=', '--name-only', ...since, b, '--not', 'HEAD', start.head).split('\n').filter(Boolean);
        if (!files.length) continue;
        branches.push(b);
        for (const f of files) all.add(f);
      }
    } catch {}
  }
  const list = [...all];
  return { all: list, source: list.filter((f) => !NON_SOURCE.test(f)), branches };
}

export const changedSource = (dir, sessionId) => changedFiles(dir, sessionId).source;

export function evaluateGates(dir, { sessionId, registry } = {}) {
  const changed = changedFiles(dir, sessionId);
  const { source } = changed;
  const result = { applies: source.length > 0, source, missing: [], reviewers: [], verification: null, implied: [], fingerprint: null };
  if (!result.applies) return result;
  const add = (key, msg) => result.missing.push({ key, msg });
  const fp = sourceFingerprint(dir);
  result.fingerprint = fp;
  const latest = Math.max(...source.map((f) => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } }));
  // With a fingerprint (any git repo), evidence and verdicts count only at the same fingerprint; an entry without
  // one (2.x, or hand-written) is never current. Only when no fingerprint can be computed: the time rule
  // (evidence mtime ≥ latest change; ledger entries within 1 s of it).
  const freshEntry = (e, mtime, slackMs = 0) => (fp ? Boolean(e?.fingerprint) && e.fingerprint === fp : (mtime ?? e?.at ?? 0) >= latest - slackMs);

  // 1. Verification at the current content, with consistent evidence.
  const evidencePath = join(dir, '.eng', 'evidence', 'verify-latest.json');
  const verify = readJson(evidencePath);
  const vFresh = Boolean(verify?.verdict) && freshEntry(verify, existsSync(evidencePath) ? statSync(evidencePath).mtimeMs : 0);
  result.verification = verify ? { verdict: verify.verdict, at: verify.timestamp || verify.at, fresh: vFresh } : null;
  if (!vFresh) add('verification', 'verification: run /engineering-os:eng-verify (no evidence for the current content)');
  else if (verify.partial) add('verification', 'verification: the last eng-verify run was partial (--only/--skip); run the full level');
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
  const b = reg.budgets?.[cls];
  if (vFresh && b?.verify && (LEVEL_RANK[verify.level] || 0) < LEVEL_RANK[b.verify])
    add('verification', `verification: the last eng-verify run was at level ${verify.level || 'unknown'}; ${cls} needs /engineering-os:eng-verify ${b.verify}`);
  if (changed.branches.length && !skipped.has('branches'))
    add('branches', `work committed this session on ${changed.branches.join(', ')} is not in the current branch: check it out and finish its verification and reviews there, or merge it (or \`Skipped: branches (<reason>)\`)`);

  // 3. Class fits the diff (PROC-13). Tests and generated lockfiles don't count toward the ceiling.
  const impl = source.filter((f) => !TEST_FILE.test(f) && !LOCKFILE.test(f));
  if (b?.max_impl_files) {
    const areas = new Set(impl.map((f) => (f.includes('/') ? f.split('/')[0] : '.')));
    if (impl.length > b.max_impl_files || areas.size > b.max_areas)
      add('class-size', `reclassify: ${impl.length} non-test source file(s) in ${areas.size} area(s) (${[...areas].join(', ')}) exceed ${cls} (≤${b.max_impl_files} files, ≤${b.max_areas} area); set a higher Class in status.md Now and run its gates`);
  }
  if (cls === 'TRIVIAL' && declared.length) add('class-flags', `reclassify: TRIVIAL work cannot carry risk flags (${declared.join(', ')}); use SMALL or higher`);

  // 4. Risk flags fit the changed paths (and new dependencies).
  const implied = new Map();
  const words = (f) => f.replace(/([a-z0-9])([A-Z])/g, '$1-$2'); // AuthService.ts → Auth-Service.ts, useAuth → use-Auth
  for (const [flag, re] of Object.entries(reg.risk_paths || {})) {
    const rx = new RegExp(re, 'i');
    const hit = impl.find((f) => rx.test(f) || rx.test(words(f)));
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
  if (gateOn('acceptance_criteria') && !hasAcceptanceCriteria(dir, now.now, changed.all))
    add('acceptance_criteria', 'acceptance criteria: record testable `AC-n` lines in status.md or requirements.md (or `Skipped: acceptance_criteria (<reason>)`)');
  if (gateOn('plan_complete')) {
    const planText = readText(join(dir, 'docs', 'engineering', 'implementation-plan.md'));
    const parsed = planText ? parsePlan(planText) : { error: 'missing' };
    if (!parsed.error && !parsed.tasks.length) add('plan_complete', 'plan: docs/engineering/implementation-plan.md has no tasks; /engineering-os:eng-plan (or `Skipped: plan_complete (<reason>)`)');
    else if (parsed.error) add('plan_complete', `plan: docs/engineering/implementation-plan.md ${parsed.error === 'missing' ? 'is missing' : `is invalid (${parsed.error})`}; /engineering-os:eng-plan (or \`Skipped: plan_complete (<reason>)\`)`);
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
    const capIds = new Set([...(b?.reviewers || []), ...(declared.length ? b?.reviewers_if_flagged || [] : [])]);
    for (const f of declared) for (const id of reg.risk_requirements[f]) if (byId.get(id)?.reviewer_gate) capIds.add(id);
    const byAgent = new Map();
    for (const id of capIds) { const c = byId.get(id); if (c && !byAgent.has(c.agent)) byAgent.set(c.agent, c.skill || c.agent); }
    const ledger = readLedger(dir);
    for (const [agent, skill] of byAgent) {
      const entries = ledger.filter((g) => g.agent === agent && !((g.at || 0) > Date.now() + FUTURE_SLACK_MS)).sort((x, y) => (y.at || 0) - (x.at || 0));
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
