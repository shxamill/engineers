#!/usr/bin/env node
// Verification engine: runs the project's own checks (from docs/engineering/project-profile.json or live
// detection) plus deterministic diff checks (test tampering incl. CI bypass, secrets, supply chain, scope),
// prints a compact verdict, and stores full logs under .eng/evidence/. The evidence (schema 2) is bound to
// the content fingerprint of the source tree, so the completion gate accepts it only for that content.
// Exit 0 = PASS/NO_CHECKS, 1 = FAIL, 2 = usage error.
// Usage: node eng-verify.mjs [projectDir] [--level targeted|standard|full] [--only k1,k2] [--skip k] [--base ref]
//        [--task T-n] [--network] [--timeout seconds] [--json]
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from './eng-detect.mjs';
import { findSecret, sourceFingerprint, logEvent } from '../hooks/scripts/lib.mjs';

const ORDER = ['build', 'lint', 'format', 'typecheck', 'test', 'integration', 'e2e', 'security', 'secrets'];
const LABEL = { build: 'BUILD', lint: 'LINT', format: 'FORMAT', typecheck: 'TYPECHECK', test: 'TESTS', integration: 'INTEGRATION', e2e: 'E2E', security: 'SECURITY', secrets: 'SECRETS' };
const LEVELS = { targeted: ['lint', 'typecheck', 'test'], standard: ['build', 'lint', 'format', 'typecheck', 'test', 'secrets'], full: ORDER };

export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;
const SKIP_MARKER = /\b(it|test|describe|context|suite)\.(skip|only)\s*\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(|@pytest\.mark\.(skip|skipif|xfail)\b|@unittest\.skip|\bt\.Skip(Now|f)?\(|#\[ignore\]|@(Disabled|Ignore)\b|\btest\.fixme\(/;
const ASSERTION = /\b(expect|assert\w*|should)\b|\.(toBe|toEqual|toStrictEqual|toMatch|toThrow|toHaveBeenCalled|toContain)\w*\(/;
const VERIFY_CONFIG = /(^|\/)(jest|vitest|playwright|cypress|karma)\.config\.[cm]?[jt]s$|(^|\/)(pytest\.ini|tox\.ini|setup\.cfg|\.coveragerc|codecov\.ya?ml|\.eslintrc[\w.]*|eslint\.config\.[cm]?js)$|^\.github\/workflows\/|(^|\/)docs\/engineering\/project-profile\.json$/;
// Files where test/check commands and CI live (bypass detection looks at their added lines).
const CHECK_SOURCES = /(^|\/)(package\.json|Makefile|justfile|tox\.ini|noxfile\.py|pyproject\.toml|setup\.cfg|Taskfile\.ya?ml|\.pre-commit-config\.ya?ml)$|^\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)(jest|vitest|playwright)\.config\.[cm]?[jt]s$/;
const CHECK_CMD = /\b(test|tests|spec|lint|check|verify|typecheck|tsc|pytest|jest|vitest|mocha|ava|tap|go test|cargo test|eslint|ruff|mypy|pyright)\b/i;
const BYPASS = [
  [/\|\|\s*(true|:|exit\s+0)\b/, 'masks a failing check with "|| true"/"|| exit 0"'],
  [/--pass-?with-?no-?tests\b/i, 'passes with no tests (--passWithNoTests)'],
];
const COVERAGE_KEY = /\b(threshold|coverage|fail[_-]?under|branches|lines|statements|functions|min[_-]?coverage)\b/i;
const MANIFEST_LOCKS = { 'package.json': ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'], 'pyproject.toml': ['uv.lock', 'poetry.lock', 'pdm.lock'], 'Cargo.toml': ['Cargo.lock'], 'go.mod': ['go.sum'], 'Gemfile': ['Gemfile.lock'], 'composer.json': ['composer.lock'] };

const git = (root, args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
};

// Base for the diff and the PRE_EXISTING comparison: an explicit --base; else where this branch left the default
// branch; else (working on the default branch itself) the HEAD the newest session started from, so work already
// committed in this session is still checked; else HEAD.
export function resolveBase(root, explicit) {
  if (explicit) return explicit;
  const head = git(root, ['rev-parse', '--verify', 'HEAD'])?.trim();
  if (!head) return null;
  // On a local default branch, another local default branch (a stale `master` next to `main`) is not a base.
  const current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    if (['main', 'master'].includes(current) && ['main', 'master'].includes(ref)) continue;
    const mb = git(root, ['merge-base', 'HEAD', ref])?.trim();
    if (mb && mb !== head) return mb;
  }
  const stateDir = join(root, '.eng', 'state');
  let sessions = [];
  try {
    sessions = readdirSync(stateDir).filter((f) => /^session-[\w-]+\.json$/.test(f))
      .map((f) => { try { return { mtime: statSync(join(stateDir, f)).mtimeMs, head: JSON.parse(readFileSync(join(stateDir, f), 'utf8')).head }; } catch { return null; } })
      .filter((x) => x && /^[0-9a-f]{40}$/.test(x.head || '')).sort((a, b) => b.mtime - a.mtime);
  } catch {}
  const start = sessions[0]?.head;
  if (start && start !== head && git(root, ['merge-base', '--is-ancestor', start, 'HEAD']) !== null) return start;
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
  const short = (t) => t.trim().slice(0, 80);
  for (const f of files) if (f.status === 'D' && TEST_PATH.test(f.path)) tamper.push(`deleted test file ${f.path}`);
  for (const a of added) if (a.path && TEST_PATH.test(a.path) && SKIP_MARKER.test(a.text)) tamper.push(`skip/only marker added in ${a.path}: ${short(a.text)}`);
  const removedAsserts = removed.filter((r) => r.path && TEST_PATH.test(r.path) && ASSERTION.test(r.text)).length;
  const addedAsserts = added.filter((a) => a.path && TEST_PATH.test(a.path) && ASSERTION.test(a.text)).length;
  if (removedAsserts > addedAsserts) warn.push(`net assertions removed in tests (${removedAsserts} removed, ${addedAsserts} added)`);
  for (const f of files) if (VERIFY_CONFIG.test(f.path)) warn.push(`verification config changed: ${f.path}`);

  // CI / check bypass (reward-hacking patterns, research AG-5): only added lines in files that define checks.
  for (const a of added.filter((x) => x.path && CHECK_SOURCES.test(x.path))) {
    if (CHECK_CMD.test(a.text)) for (const [re, what] of BYPASS) if (re.test(a.text)) tamper.push(`${what} in ${a.path}: ${short(a.text)}`);
    if (/^\s*continue-on-error:\s*true\b/.test(a.text)) tamper.push(`continue-on-error: true added in ${a.path}`);
    if (/(^|\/)package\.json$/.test(a.path) && /"test"\s*:\s*"(echo\b[^"]*|exit 0|true|:)"/.test(a.text)) tamper.push(`test script replaced by a no-op in ${a.path}: ${short(a.text)}`);
  }
  // Lowered coverage thresholds: a removed and an added line with the same key, smaller number.
  for (const r of removed.filter((x) => x.path && (CHECK_SOURCES.test(x.path) || VERIFY_CONFIG.test(x.path)) && COVERAGE_KEY.test(x.text))) {
    const key = r.text.match(COVERAGE_KEY)[1].toLowerCase();
    const before = Number((r.text.match(/(\d+(?:\.\d+)?)/) || [])[1]);
    const after = added.find((a) => a.path === r.path && a.text.toLowerCase().includes(key) && /\d/.test(a.text));
    const now = after ? Number(after.text.match(/(\d+(?:\.\d+)?)/)[1]) : NaN;
    if (Number.isFinite(before) && Number.isFinite(now) && now < before) warn.push(`coverage threshold lowered in ${r.path} (${key}: ${before} → ${now})`);
  }

  // Supply chain (research SEC-6/7): workflow hardening, lockfile drift, new dependencies.
  const supply = { fail: [], warn: [] };
  for (const a of added.filter((x) => x.path && /^\.github\/workflows\//.test(x.path))) {
    const use = a.text.match(/^\s*-?\s*uses:\s*["']?([^@\s"']+)@([^\s#"']+)/);
    if (use && !use[1].startsWith('./') && !use[1].startsWith('docker://') && !/^[0-9a-f]{40}$/.test(use[2])) supply.warn.push(`action not pinned to a full SHA: ${use[1]}@${use[2]}`);
    if (/^\s*permissions:\s*write-all\b/.test(a.text)) supply.fail.push(`permissions: write-all in ${a.path}`);
    if (/github\.event\.pull_request\.head\.(sha|ref)/.test(a.text)) {
      let content = '';
      try { content = readFileSync(join(root, a.path), 'utf8'); } catch {}
      if (/pull_request_target/.test(content)) supply.fail.push(`pull_request_target workflow checks out PR head code in ${a.path}`);
    }
  }
  const changed = new Set(files.map((f) => f.path));
  for (const f of files) {
    const name = f.path.split('/').pop();
    const locks = MANIFEST_LOCKS[name];
    if (!locks || f.status === 'D') continue;
    const dirOf = f.path.includes('/') ? `${f.path.slice(0, f.path.lastIndexOf('/'))}/` : '';
    const present = locks.filter((l) => existsSync(join(root, dirOf, l)));
    if (present.length && !present.some((l) => changed.has(`${dirOf}${l}`)) && added.some((a) => a.path === f.path))
      supply.warn.push(`${f.path} changed but its lockfile (${present.join(', ')}) did not`);
  }
  const newDependencies = findNewDependencies(root, base, files, added, removed);

  const secrets = [];
  for (const a of added) { const s = findSecret(a.text); if (s) secrets.push(`${s} in ${a.path}`); }
  return { files, tamper, warn, secrets, supply, newDependencies, linesAdded: added.length, linesRemoved: removed.length, testFilesChanged: files.filter((f) => TEST_PATH.test(f.path)).length };
}

// Dependencies added by this change: package.json (all dependency sections), requirements*.txt, go.mod.
export function findNewDependencies(root, base, files, added, removed) {
  const out = new Set();
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x.path) && x.status !== 'D')) {
    const sections = (pkg) => new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((s) => Object.keys(pkg?.[s] || {})));
    let now = null;
    let before = null;
    try { now = JSON.parse(readFileSync(join(root, f.path), 'utf8')); } catch {}
    try { before = base ? JSON.parse(git(root, ['show', `${base}:${f.path}`]) || 'null') : null; } catch {}
    const prev = sections(before);
    for (const d of sections(now)) if (!prev.has(d)) out.add(`npm:${d}`);
  }
  const name = (t) => (t.match(/^\s*([A-Za-z0-9][\w.-]*)/) || [])[1]?.toLowerCase();
  for (const kind of [[/(^|\/)requirements[^/]*\.txt$/, 'pypi', (t) => !/^\s*(#|-)/.test(t) && name(t)], [/(^|\/)go\.mod$/, 'go', (t) => (t.match(/^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+v\d/) || [])[1]]]) {
    const [re, eco, pick] = kind;
    const gone = new Set(removed.filter((r) => r.path && re.test(r.path)).map((r) => pick(r.text)).filter(Boolean));
    for (const a of added.filter((x) => x.path && re.test(x.path))) { const n = pick(a.text); if (n && !gone.has(n)) out.add(`${eco}:${n}`); }
  }
  return [...out];
}

// Output lines with the checkout path, colors, and timings removed, so a run in the baseline worktree compares
// equal to the same failure in the project. Paths appear raw, with escaped backslashes (Windows, node's inspect),
// and as file:// URLs with %-encoding (C:/Users/RUNNER%7E1/...), so all of them are folded to forward slashes first.
const slashes = (s) => s.replace(/\\\\/g, '/').replace(/\\/g, '/');
export const normalize = (out, root) => new Set(slashes(out).replace(/file:\/\/(\/(?=[A-Za-z]:))?/g, '').replace(/%7E/gi, '~')
  .replaceAll(slashes(root).replace(/\/+$/, ''), '<root>').replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  .map((l) => l.replace(/\d+(\.\d+)?\s?(ms|s)\b/g, '<t>').replace(/\b(duration_ms|duration):?\s*[\d.]+/g, '$1 <t>').trim())
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
  // NOT_RUN only when the tool itself is missing (shell 127, "command not found", npm/spawn ENOENT), never because a
  // failing test's own output mentions ENOENT.
  else if (r.error?.code === 'ENOENT' || r.status === 127 || (r.status !== 0 && /command not found|: not found\s*$|is not recognized as an internal or external command|npm (ERR!|error) (code|enoent) ENOENT|spawn \S+ ENOENT/im.test(output.slice(0, 600)))) status = 'NOT_RUN';
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
  const notApplicable = profile.overrides?.notApplicable || {}; // { kind: "reason" } — declared, never assumed
  let checks = [...(profile.checks || []), ...(profile.overrides?.checks || [])].filter((c) => !disabled.has(c.id));
  const level = opts.level || 'standard';
  const kinds = opts.only?.length ? opts.only : LEVELS[level] || LEVELS.standard;
  const fingerprint = sourceFingerprint(root);
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
    if (!rs.length && notApplicable[kind]) { lines.push(`${LABEL[kind]}: NOT_APPLICABLE (${notApplicable[kind]})`); continue; }
    if (!rs.length) { lines.push(`${LABEL[kind]}: NOT_RUN (${opts.skip?.includes(kind) ? 'skipped with --skip' : `no ${kind} command configured`})`); continue; }
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
    if (diff.supply.fail.length) failed = true;
    const deps = diff.newDependencies.length ? ` · new dependencies: ${diff.newDependencies.slice(0, 6).join(', ')} (flag new-dependency)` : '';
    lines.push(`SUPPLY-CHAIN: ${diff.supply.fail.length ? `FAIL → ${diff.supply.fail.slice(0, 4).join('; ')}` : diff.supply.warn.length ? `WARN → ${diff.supply.warn.slice(0, 4).join('; ')}` : 'PASS'}${deps}`);
    const areas = [...new Set(diff.files.map((f) => f.path.split('/').slice(0, 2).join('/')))];
    lines.push(`SCOPE: ${diff.files.length} file(s) changed vs ${base || 'empty tree'} (${diff.testFilesChanged} test; +${diff.linesAdded}/-${diff.linesRemoved} lines) in ${areas.slice(0, 8).join(', ')}${areas.length > 8 ? ', …' : ''}`);
  }
  const ran = results.filter((r) => r.status !== 'NOT_RUN').length;
  const verdict = failed ? 'FAIL' : ran === 0 ? 'NO_CHECKS' : 'PASS';
  const pre = results.filter((r) => r.status === 'PRE_EXISTING').map((r) => r.id);
  lines.push(`VERDICT: ${verdict}${pre.length ? ` (pre-existing failures, report but don't fix out of scope: ${pre.join(', ')})` : ''}${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}`);
  const rel = (p) => relative(root, p).replace(/\\/g, '/');
  lines.push(`EVIDENCE: ${rel(evidenceDir)} · checks from ${source}`);
  const commit = (git(root, ['rev-parse', 'HEAD']) || '').trim() || null;
  // Evidence schema 2: bound to the content fingerprint; one record per check, never silently omitted.
  const checkRecords = [
    ...results.map((r) => ({ name: r.id, kind: r.kind, status: r.status, command: r.cmd, durationMs: r.ms, evidence: rel(r.log) })),
    ...kinds.filter((k) => k !== 'secrets' && !results.some((r) => r.kind === k)).map((k) => ({ name: k, kind: k, status: notApplicable[k] ? 'NOT_APPLICABLE' : 'NOT_RUN', command: null, reason: notApplicable[k] || (opts.skip?.includes(k) ? 'skipped with --skip' : `no ${k} command configured`) })),
  ];
  const summary = {
    // partial: a subset of the level's checks ran (--only/--skip); the completion gate does not accept it.
    schema: 2, task: opts.task || null, commit, fingerprint, timestamp: new Date().toISOString(), at: new Date().toISOString(),
    level, partial: Boolean(opts.only?.length || opts.skip?.length), base, verdict, checks: checkRecords, lines, evidence: rel(evidenceDir),
    signals: diff ? { tamper: diff.tamper, warn: diff.warn, secrets: diff.secrets, supplyChain: diff.supply, newDependencies: diff.newDependencies, files: diff.files.length, linesAdded: diff.linesAdded, linesRemoved: diff.linesRemoved } : null,
    results: results.map(({ log, ...r }) => ({ ...r, log })),
  };
  writeFileSync(join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(root, '.eng', 'evidence', 'verify-latest.json'), JSON.stringify(summary, null, 2));
  logEvent(root, { event: 'verify', verdict, level, task: summary.task, failing: [...new Set(results.filter((r) => ['FAIL', 'TIMEOUT'].includes(r.status)).map((r) => r.kind))], tamper: diff?.tamper.length || 0, secrets: diff?.secrets.length || 0, supplyChainFail: diff?.supply.fail.length || 0 });
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const list = (n) => (val(n) || '').split(',').filter(Boolean);
  const VALUED = ['--level', '--only', '--skip', '--base', '--timeout', '--task'];
  const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  const level = val('level') || positional.find((a) => LEVELS[a]) || 'standard';
  const root = positional.find((a) => !LEVELS[a]) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!existsSync(root)) { console.error(`eng-verify: no such directory ${root}`); process.exit(2); }
  const s = verify(root, { level, only: list('only'), skip: list('skip'), base: val('base'), task: val('task'), network: args.includes('--network'), timeout: Number(val('timeout')) || undefined });
  console.log(args.includes('--json') ? JSON.stringify(s, null, 2) : s.lines.join('\n'));
  process.exit(s.verdict === 'FAIL' ? 1 : 0);
}
