#!/usr/bin/env node
// Verification engine: runs the project's own checks (from docs/engineering/project-profile.json or live
// detection) plus deterministic diff checks (test tampering, secrets, scope), prints a compact verdict,
// and stores full logs under .eng/evidence/. Exit 0 = PASS/NO_CHECKS, 1 = FAIL, 2 = usage error.
// Usage: node eng-verify.mjs [projectDir] [--level targeted|standard|full] [--only k1,k2] [--skip k] [--base ref]
//        [--network] [--timeout seconds] [--json]
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from './eng-detect.mjs';
import { findSecret } from '../hooks/scripts/lib.mjs';

const ORDER = ['build', 'lint', 'format', 'typecheck', 'test', 'integration', 'e2e', 'security', 'secrets'];
const LABEL = { build: 'BUILD', lint: 'LINT', format: 'FORMAT', typecheck: 'TYPECHECK', test: 'TESTS', integration: 'INTEGRATION', e2e: 'E2E', security: 'SECURITY', secrets: 'SECRETS' };
const LEVELS = { targeted: ['lint', 'typecheck', 'test'], standard: ['build', 'lint', 'format', 'typecheck', 'test', 'secrets'], full: ORDER };

export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;
const SKIP_MARKER = /\b(it|test|describe|context|suite)\.(skip|only)\s*\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(|@pytest\.mark\.(skip|skipif|xfail)\b|@unittest\.skip|\bt\.Skip(Now|f)?\(|#\[ignore\]|@(Disabled|Ignore)\b|\btest\.fixme\(/;
const ASSERTION = /\b(expect|assert\w*|should)\b|\.(toBe|toEqual|toStrictEqual|toMatch|toThrow|toHaveBeenCalled|toContain)\w*\(/;
const VERIFY_CONFIG = /(^|\/)(jest|vitest|playwright|cypress|karma)\.config\.[cm]?[jt]s$|(^|\/)(pytest\.ini|tox\.ini|setup\.cfg|\.coveragerc|codecov\.ya?ml|\.eslintrc[\w.]*|eslint\.config\.[cm]?js)$|^\.github\/workflows\/|(^|\/)docs\/engineering\/project-profile\.json$/;

const git = (root, args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
};

export function resolveBase(root, explicit) {
  if (explicit) return explicit;
  if (git(root, ['rev-parse', '--verify', 'HEAD']) === null) return null;
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    const mb = git(root, ['merge-base', 'HEAD', ref]);
    const head = git(root, ['rev-parse', 'HEAD']);
    if (mb && mb.trim() !== head?.trim()) return mb.trim();
  }
  return 'HEAD';
}

// Deterministic diff analysis: changed files, test tampering, secrets in added content.
export function analyzeDiff(root, base) {
  const files = [];
  const added = [];
  const removed = [];
  if (base) {
    for (const line of (git(root, ['diff', '--name-status', '-M', base]) || '').split('\n').filter(Boolean)) {
      const [st, ...paths] = line.split('\t');
      files.push({ status: st[0], path: paths[paths.length - 1], from: paths.length > 1 ? paths[0] : null });
    }
    let current = null;
    for (const line of (git(root, ['diff', '--unified=0', '--no-color', base]) || '').split('\n')) {
      if (line.startsWith('+++ ')) { current = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
      if (line.startsWith('--- ')) continue;
      if (line.startsWith('+')) added.push({ path: current, text: line.slice(1) });
      else if (line.startsWith('-')) removed.push({ path: current, text: line.slice(1) });
    }
  }
  const untracked = (git(root, ['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean).slice(0, 500);
  for (const p of untracked) {
    files.push({ status: 'A', path: p, from: null });
    try { if (statSync(join(root, p)).size < 1_000_000) for (const t of readFileSync(join(root, p), 'utf8').split('\n')) added.push({ path: p, text: t }); } catch {}
  }

  const tamper = [];
  const warn = [];
  for (const f of files) if (f.status === 'D' && TEST_PATH.test(f.path)) tamper.push(`deleted test file ${f.path}`);
  for (const a of added) if (a.path && TEST_PATH.test(a.path) && SKIP_MARKER.test(a.text)) tamper.push(`skip/only marker added in ${a.path}: ${a.text.trim().slice(0, 80)}`);
  const removedAsserts = removed.filter((r) => r.path && TEST_PATH.test(r.path) && ASSERTION.test(r.text)).length;
  const addedAsserts = added.filter((a) => a.path && TEST_PATH.test(a.path) && ASSERTION.test(a.text)).length;
  if (removedAsserts > addedAsserts) warn.push(`net assertions removed in tests (${removedAsserts} removed, ${addedAsserts} added)`);
  for (const f of files) if (VERIFY_CONFIG.test(f.path)) warn.push(`verification config changed: ${f.path}`);

  const secrets = [];
  for (const a of added) { const s = findSecret(a.text); if (s) secrets.push(`${s} in ${a.path}`); }
  return { files, tamper, warn, secrets, testFilesChanged: files.filter((f) => TEST_PATH.test(f.path)).length };
}

const normalize = (out, root) => new Set(out.replaceAll(root, '<root>').replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  .map((l) => l.replace(/\d+(\.\d+)?\s?(ms|s)\b/g, '<t>').trim())
  .filter((l) => l && !/^(#\s*(duration|start|tests|suites|pass|fail|cancelled|skipped|todo)|ℹ|>|\$ |\(cwd:)/.test(l)));

// For a failing check, re-run it at the base revision in a temporary worktree. If every failure line also
// appears at the base, the failure is pre-existing (reported, but not blamed on this change).
export function baselineCompare(root, base, check, timeoutSec, currentOutput) {
  if (!base) return null;
  const tmp = join(root, '.eng', 'baseline', `wt-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(join(root, '.eng', 'baseline'), { recursive: true });
    if (git(root, ['worktree', 'add', '--detach', '--quiet', tmp, base]) === null) return null;
    if (existsSync(join(root, 'node_modules'))) try { symlinkSync(join(root, 'node_modules'), join(tmp, 'node_modules'), 'junction'); } catch {}
    const r = spawnSync(check.cmd, { cwd: join(tmp, check.cwd || '.'), shell: true, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    if (r.status === 0) return { preExisting: false };
    const before = normalize(`${r.stdout || ''}${r.stderr || ''}`, tmp);
    const now = normalize(currentOutput, root);
    const fresh = [...now].filter((l) => !before.has(l));
    return { preExisting: fresh.length === 0, fresh: fresh.slice(0, 3) };
  } catch {
    return null;
  } finally {
    git(root, ['worktree', 'remove', '--force', tmp]);
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function runCheck(root, check, evidenceDir, timeoutSec) {
  const started = Date.now();
  const r = spawnSync(check.cmd, { cwd: join(root, check.cwd || '.'), shell: true, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  const ms = Date.now() - started;
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const log = join(evidenceDir, `${check.id.replace(/[^\w.-]+/g, '_')}.log`);
  writeFileSync(log, `$ ${check.cmd}\n(cwd: ${check.cwd || '.'}; exit: ${r.status}; ${ms}ms)\n\n${output}`);
  let status = r.status === 0 ? 'PASS' : 'FAIL';
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') status = 'TIMEOUT';
  else if (r.status === 127 || /command not found|is not recognized as an internal or external command|ENOENT/i.test(output.slice(0, 400)) && r.status !== 0) status = 'NOT_RUN';
  const tail = output.trim().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 240);
  return { ...check, status, exit: r.status, ms, log, tail, output };
}

export function verify(root, opts = {}) {
  const profilePath = join(root, 'docs', 'engineering', 'project-profile.json');
  let profile = null;
  try { profile = JSON.parse(readFileSync(profilePath, 'utf8')); } catch {}
  const source = profile ? 'docs/engineering/project-profile.json' : 'live detection (run /engineering-os:eng-init to persist)';
  profile ||= detect(root);
  const disabled = new Set(profile.overrides?.disable || []);
  let checks = [...(profile.checks || []), ...(profile.overrides?.checks || [])].filter((c) => !disabled.has(c.id));
  const level = opts.level || 'standard';
  const kinds = opts.only?.length ? opts.only : LEVELS[level] || LEVELS.standard;
  const skipped = [];
  checks = checks.filter((c) => {
    if (!kinds.includes(c.kind) || opts.skip?.includes(c.kind)) return false;
    if (c.network && !opts.network) { skipped.push(`${c.id} (needs --network)`); return false; }
    return true;
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = join(root, '.eng', 'evidence', `verify-${stamp}`);
  mkdirSync(evidenceDir, { recursive: true });
  const results = checks.map((c) => runCheck(root, c, evidenceDir, opts.timeout || 600));

  const base = resolveBase(root, opts.base);
  if (opts.baseline !== false && base) {
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      const cmp = baselineCompare(root, base, r, opts.timeout || 600, r.output);
      if (cmp?.preExisting) { r.status = 'PRE_EXISTING'; r.tail = `also fails at ${base.slice(0, 7)} with the same output — not caused by this change`; }
      else if (cmp?.fresh?.length) r.tail = `new vs ${base.slice(0, 7)}: ${cmp.fresh.join(' | ').slice(0, 200)}`;
    }
  }
  for (const r of results) delete r.output;
  const diff = git(root, ['rev-parse', '--is-inside-work-tree']) ? analyzeDiff(root, base) : null;
  const lines = [];
  for (const kind of ORDER) {
    if (kind === 'secrets') continue;
    const rs = results.filter((r) => r.kind === kind);
    if (!kinds.includes(kind)) continue;
    if (!rs.length) { lines.push(`${LABEL[kind]}: NOT_RUN (no ${kind} command configured)`); continue; }
    const worst = ['FAIL', 'TIMEOUT', 'PRE_EXISTING', 'NOT_RUN', 'PASS'].find((s) => rs.some((r) => r.status === s));
    const detail = rs.filter((r) => r.status !== 'PASS').map((r) => `${r.id}: exit ${r.exit}${r.tail ? ` — ${r.tail}` : ''}`).join('; ');
    lines.push(`${LABEL[kind]}: ${worst} (${rs.map((r) => `\`${r.cmd}\` ${r.ms}ms`).join(', ')})${detail ? ` → ${detail}` : ''}`);
  }
  const extSecrets = results.filter((r) => r.kind === 'secrets');
  let failed = results.some((r) => r.status === 'FAIL' || r.status === 'TIMEOUT');
  if (diff) {
    const secretFail = diff.secrets.length || extSecrets.some((r) => r.status === 'FAIL');
    if (secretFail) failed = true;
    lines.push(`SECRETS: ${secretFail ? `FAIL → ${[...diff.secrets, ...extSecrets.filter((r) => r.status === 'FAIL').map((r) => r.id)].slice(0, 5).join('; ')}` : 'PASS'} (diff scan${extSecrets.length ? ' + gitleaks' : ''})`);
    if (diff.tamper.length) failed = true;
    lines.push(`TESTS-TAMPER: ${diff.tamper.length ? `FAIL → ${diff.tamper.slice(0, 5).join('; ')}` : diff.warn.length ? `WARN → ${diff.warn.slice(0, 4).join('; ')}` : 'PASS'}`);
    const areas = [...new Set(diff.files.map((f) => f.path.split('/').slice(0, 2).join('/')))];
    lines.push(`SCOPE: ${diff.files.length} file(s) changed vs ${base || 'empty tree'} (${diff.testFilesChanged} test) in ${areas.slice(0, 8).join(', ')}${areas.length > 8 ? ', …' : ''}`);
  }
  const ran = results.filter((r) => r.status !== 'NOT_RUN').length;
  const verdict = failed ? 'FAIL' : ran === 0 ? 'NO_CHECKS' : 'PASS';
  const pre = results.filter((r) => r.status === 'PRE_EXISTING').map((r) => r.id);
  lines.push(`VERDICT: ${verdict}${pre.length ? ` (pre-existing failures, report but don't fix out of scope: ${pre.join(', ')})` : ''}${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}`);
  lines.push(`EVIDENCE: ${evidenceDir.replace(`${root}/`, '').replace(`${root}\\`, '')} · checks from ${source}`);
  const summary = { verdict, level, base, at: new Date().toISOString(), lines, results: results.map(({ log, ...r }) => ({ ...r, log })), diff: diff && { files: diff.files.length, tamper: diff.tamper, warn: diff.warn, secrets: diff.secrets } };
  writeFileSync(join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(root, '.eng', 'evidence', 'verify-latest.json'), JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const list = (n) => (val(n) || '').split(',').filter(Boolean);
  const VALUED = ['--level', '--only', '--skip', '--base', '--timeout'];
  const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  const level = val('level') || positional.find((a) => LEVELS[a]) || 'standard';
  const root = positional.find((a) => !LEVELS[a]) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!existsSync(root)) { console.error(`eng-verify: no such directory ${root}`); process.exit(2); }
  const s = verify(root, { level, only: list('only'), skip: list('skip'), base: val('base'), network: args.includes('--network'), timeout: Number(val('timeout')) || undefined });
  console.log(args.includes('--json') ? JSON.stringify(s, null, 2) : s.lines.join('\n'));
  process.exit(s.verdict === 'FAIL' ? 1 : 0);
}
