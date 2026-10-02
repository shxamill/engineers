#!/usr/bin/env node
// Tests for the deterministic engines: yaml-lite, router, project adapter, verifier, plan checker.
// Run: node scripts/test-engines.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml } from './lib/yaml-lite.mjs';
import { classify, route, loadRegistry, riskFromDims } from './eng-route.mjs';
import { detect } from './eng-detect.mjs';
import { verify, normalize } from './eng-verify.mjs';
import { parsePlan, checkPlan } from './eng-plan-check.mjs';
import { checkRelease, envPresence } from './eng-release-check.mjs';
import { metrics } from './eng-status.mjs';
import { sourceFingerprint } from '../hooks/scripts/lib.mjs';

let count = 0;
let failures = 0;
const expect = (name, ok, detail = '') => {
  count++;
  if (!ok) { failures++; console.log(`FAIL ${name}${detail ? `\n     ${String(detail).slice(0, 400)}` : ''}`); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const tmp = mkdtempSync(join(tmpdir(), 'eng-engines-'));
const fixture = (name, files) => {
  const dir = join(tmp, name);
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); }
  return dir;
};
const git = (dir, ...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
const initRepo = (dir) => { git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@e.st'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base'); };

try {
  // ---------- yaml-lite ----------
  const y = parseYaml('a: 1\nb: [x, "y, z", 3]\nc:\n  d: true\nlist:\n  - id: one\n    tags: []\n  - id: two # comment\n    nested:\n      k: v\nplain:\n  - p\n  - "q"\n');
  expect('yaml: scalars, inline lists, nesting, comments', y.a === 1 && y.b[1] === 'y, z' && y.c.d === true && y.list[1].nested.k === 'v' && y.plain[1] === 'q' && y.list[0].tags.length === 0, JSON.stringify(y));
  expect('yaml: rejects tabs', throws(() => parseYaml('a:\n\tb: 1')));
  expect('yaml: rejects inline maps', throws(() => parseYaml('a: {b: 1}')));
  expect('yaml: rejects duplicate keys', throws(() => parseYaml('a: 1\na: 2')));

  // ---------- router ----------
  const reg = loadRegistry();
  expect('registry: 31 capabilities, 5 budgets', reg.capabilities.length === 31 && Object.keys(reg.budgets).length === 5, reg.capabilities.length);
  expect('classify: scope maps to class', classify('medium', 'low') === 'MEDIUM' && classify('large', 'medium') === 'LARGE');
  expect('classify: critical risk => CRITICAL', classify('small', 'critical') === 'CRITICAL');
  expect('classify: high-risk trivial is not TRIVIAL', classify('trivial', 'high') === 'SMALL');
  expect('classify: risk does not inflate size otherwise', classify('small', 'high') === 'SMALL');
  expect('classify: rejects unknown scope', throws(() => classify('huge', 'low')));
  const trivial = route({ request: 'fix typo in README docs', scope: 'trivial', risk: 'low' }, reg);
  expect('route: TRIVIAL staffs nobody and has no reviewers', trivial.staffed.length === 0 && trivial.reviewers.length === 0, JSON.stringify(trivial));
  const small = route({ request: 'add a cli flag and an api endpoint and a react component', scope: 'small', risk: 'low' }, reg);
  expect('route: SMALL staffs at most one specialist', small.staffed.length <= 1 && small.reviewers.some((r) => r.id === 'code-review'), JSON.stringify(small.staffed));
  const auth = route({ request: 'add login to the express api', scope: 'medium', risk: 'high', flags: ['auth'] }, reg);
  expect('route: auth flag makes threat-modeling + appsec mandatory', auth.mandatory.some((m) => m.startsWith('threat-modeling')) && auth.reviewers.some((r) => r.id === 'appsec'), JSON.stringify(auth));
  expect('route: medium includes scope-judge', auth.reviewers.some((r) => r.id === 'scope-judge'));
  const ai = route({ request: 'classify sentiment with the llm', scope: 'small', risk: 'medium', flags: ['ai'] }, reg);
  expect('route: each risk flag carries its required evidence', ai.deliverables.length === 1 && /eval set/.test(ai.deliverables[0].evidence), JSON.stringify(ai.deliverables));
  expect('route: unknown risk flag throws', throws(() => route({ request: 'x', scope: 'small', risk: 'low', flags: ['bogus'] }, reg)));
  const big = route({ request: 'build a saas with dashboard, stripe payments, postgres database, ci pipeline', scope: 'large', risk: 'critical', flags: ['payments', 'pii'] }, reg);
  expect('route: CRITICAL respects max_agents budget', big.staffed.length <= reg.budgets.CRITICAL.max_agents && big.class === 'CRITICAL');

  // ---------- project adapter ----------
  const node = fixture('node', {
    'package.json': JSON.stringify({ scripts: { lint: 'node -e 0', test: 'node --test', build: 'node -e 0' }, devDependencies: { typescript: '5', vitest: '1', react: '18' } }),
    'package-lock.json': '{}', 'tsconfig.json': '{}', '.github/workflows/ci.yml': 'on: push', 'Dockerfile': 'FROM node',
  });
  const np = detect(node);
  const kinds = np.checks.map((c) => c.kind);
  expect('detect: node/npm with lint, typecheck(tsc), test, build, audit', np.packageManager === 'npm' && ['lint', 'typecheck', 'test', 'build', 'security'].every((k) => kinds.includes(k)) && np.languages.includes('typescript'), JSON.stringify(np.checks));
  expect('detect: tsc fallback command', np.checks.find((c) => c.kind === 'typecheck').cmd === 'npx tsc --noEmit');
  expect('detect: audit is marked network', np.checks.find((c) => c.kind === 'security').network === true);
  expect('detect: frameworks, CI, deploy', np.frameworks.includes('react') && np.testFrameworks.includes('vitest') && np.ci.length === 1 && np.deploy.includes('docker'));
  const pnpm = detect(fixture('pnpm', { 'package.json': JSON.stringify({ scripts: { test: 'vitest run', 'type-check': 'tsc' } }), 'pnpm-lock.yaml': '' }));
  expect('detect: pnpm run commands', pnpm.packageManager === 'pnpm' && pnpm.checks.some((c) => c.cmd === 'pnpm run test') && pnpm.checks.some((c) => c.cmd === 'pnpm run type-check'), JSON.stringify(pnpm.checks));
  const noTest = detect(fixture('notest', { 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }));
  expect('detect: ignores npm placeholder test script', !noTest.checks.some((c) => c.kind === 'test') && noTest.notes.some((n) => n.includes('no test')));
  const py = detect(fixture('py', { 'pyproject.toml': '[project]\ndependencies=["fastapi"]\n[tool.ruff]\n[tool.pytest.ini_options]\n', 'uv.lock': '' }));
  expect('detect: python/uv with ruff + pytest', py.packageManager === 'uv' && py.checks.some((c) => c.cmd === 'uv run ruff check .') && py.checks.some((c) => c.cmd === 'uv run pytest -q') && py.frameworks.includes('fastapi'), JSON.stringify(py.checks));
  const go = detect(fixture('go', { 'go.mod': 'module x' }));
  expect('detect: go vet/test/build', ['go vet ./...', 'go test ./...', 'go build ./...'].every((c) => go.checks.some((k) => k.cmd === c)));
  const mono = detect(fixture('mono', { 'package.json': JSON.stringify({ workspaces: ['apps/*'] }), 'apps/web/package.json': JSON.stringify({ scripts: { test: 'vitest' }, dependencies: { next: '14' } }) }));
  expect('detect: workspaces produce per-package checks', mono.monorepo && mono.checks.some((c) => c.cwd === 'apps/web' && c.kind === 'test') && mono.frameworks.includes('nextjs'), JSON.stringify(mono.checks));
  const empty = detect(fixture('empty', { 'README.md': '# x' }));
  expect('detect: empty project reports gaps', empty.checks.length === 0 && empty.notes.length >= 4);

  // ---------- verifier ----------
  const app = fixture('app', {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test', lint: 'node -e "process.exit(0)"' } }),
    'src/sum.js': 'export const sum = (a, b) => a + b;\n',
    'test/sum.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.js';\ntest('adds', () => assert.equal(sum(1, 2), 3));\ntest('zero', () => assert.equal(sum(0, 0), 0));\n",
    '.gitignore': '.eng/\n',
  });
  initRepo(app);
  let s = verify(app, { level: 'standard' });
  expect('verify: clean project PASS with evidence', s.verdict === 'PASS' && existsSync(join(app, '.eng', 'evidence', 'verify-latest.json')), s.lines.join('\n'));
  expect('verify: compact lines include TESTS/LINT/SECRETS/TESTS-TAMPER/SCOPE/VERDICT', ['TESTS: PASS', 'LINT: PASS', 'SECRETS: PASS', 'TESTS-TAMPER: PASS', 'SCOPE:', 'VERDICT: PASS'].every((k) => s.lines.some((l) => l.startsWith(k))), s.lines.join('\n'));
  expect('verify: missing kinds are NOT_RUN, not PASS', s.lines.some((l) => l.startsWith('BUILD: NOT_RUN')));
  writeFileSync(join(app, 'src', 'sum.js'), 'export const sum = (a, b) => a - b;\n');
  s = verify(app, {});
  expect('verify: failing test => FAIL with log tail', s.verdict === 'FAIL' && s.lines.some((l) => l.startsWith('TESTS: FAIL')), s.lines.join('\n'));
  git(app, 'checkout', '--', 'src/sum.js');
  writeFileSync(join(app, 'test', 'sum.test.js'), readFileSync(join(app, 'test', 'sum.test.js'), 'utf8').replace("test('zero'", "test.skip('zero'"));
  s = verify(app, {});
  expect('verify: added test.skip => TESTS-TAMPER FAIL', s.verdict === 'FAIL' && s.lines.some((l) => l.startsWith('TESTS-TAMPER: FAIL')), s.lines.join('\n'));
  git(app, 'checkout', '--', 'test/sum.test.js');
  unlinkSync(join(app, 'test', 'sum.test.js'));
  s = verify(app, { only: ['lint'] });
  expect('verify: deleted test file => TESTS-TAMPER FAIL', s.verdict === 'FAIL' && s.lines.some((l) => /deleted test file/.test(l)), s.lines.join('\n'));
  git(app, 'checkout', '--', 'test/sum.test.js');
  writeFileSync(join(app, 'test', 'sum.test.js'), readFileSync(join(app, 'test', 'sum.test.js'), 'utf8').replace(/test\('zero', \(\) => assert\.equal\(sum\(0, 0\), 0\)\);\r?\n/, '')); // checkout may restore CRLF (core.autocrlf on Windows)
  s = verify(app, {});
  expect('verify: removed assertions => WARN (not FAIL)', s.verdict === 'PASS' && s.lines.some((l) => l.startsWith('TESTS-TAMPER: WARN')), s.lines.join('\n'));
  git(app, 'checkout', '--', 'test/sum.test.js');
  writeFileSync(join(app, 'src', 'config.js'), `export const key = "${'AKIA' + 'Q'.repeat(16)}";\n`);
  s = verify(app, { only: ['lint'] });
  expect('verify: secret in new file => SECRETS FAIL', s.verdict === 'FAIL' && s.lines.some((l) => l.startsWith('SECRETS: FAIL')), s.lines.join('\n'));
  unlinkSync(join(app, 'src', 'config.js'));
  const nc = fixture('nochecks', { 'README.md': '# nothing' });
  initRepo(nc);
  s = verify(nc, {});
  expect('verify: project without checks => NO_CHECKS', s.verdict === 'NO_CHECKS', s.lines.join('\n'));
  const missingTool = fixture('missingtool', { 'package.json': JSON.stringify({ scripts: { lint: 'definitely-not-a-real-binary-xyz' } }) });
  s = verify(missingTool, { only: ['lint'] });
  expect('verify: missing tool => NOT_RUN, not FAIL', s.results[0]?.status === 'NOT_RUN' && s.verdict === 'NO_CHECKS', JSON.stringify(s.results));
  const ovr = fixture('overrides', {
    'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }),
    'docs/engineering/project-profile.json': JSON.stringify({ checks: [{ id: 'test', kind: 'test', cmd: 'node -e "process.exit(1)"', cwd: '.' }], overrides: { disable: ['test'], checks: [{ id: 'custom', kind: 'lint', cmd: 'node -e 0', cwd: '.' }] } }),
  });
  s = verify(ovr, {});
  expect('verify: profile overrides disable and add checks', s.verdict === 'PASS' && s.results.length === 1 && s.results[0].id === 'custom', JSON.stringify(s.results));

  // Baseline-aware failures: pre-existing failures are reported but don't fail the change; new ones do.
  const lintScript = "import{readdirSync,readFileSync}from'node:fs';let bad=0;for(const f of readdirSync('src'))if(/\\bvar\\s/.test(readFileSync('src/'+f,'utf8'))){console.error('lint: src/'+f+' uses var');bad++}process.exit(bad?1:0)";
  const base = fixture('baseline', {
    'package.json': JSON.stringify({ type: 'module', scripts: { lint: 'node lint.mjs' } }),
    'lint.mjs': lintScript, 'src/legacy.js': 'var x = 1;\nexport { x };\n', 'src/ok.js': 'export const ok = 1;\n', '.gitignore': '.eng/\n',
  });
  initRepo(base);
  writeFileSync(join(base, 'src', 'ok.js'), 'export const ok = 2;\n');
  s = verify(base, { only: ['lint'] });
  expect('verify: pre-existing failure => PRE_EXISTING, verdict PASS', s.verdict === 'PASS' && s.results[0].status === 'PRE_EXISTING' && s.lines.some((l) => /pre-existing failures/.test(l)), s.lines.join('\n'));
  writeFileSync(join(base, 'src', 'new.js'), 'var y = 2;\nexport { y };\n');
  s = verify(base, { only: ['lint'] });
  expect('verify: new failure on top of baseline => FAIL naming the new line', s.verdict === 'FAIL' && s.lines.some((l) => /new vs .*src\/new\.js/.test(l)), s.lines.join('\n'));
  expect('verify: baseline worktree cleaned up', !(git(base, 'worktree', 'list').stdout || '').includes('.eng/baseline'));

  // ---------- plan checker ----------
  const header = '| ID | Objective | Capability | Owner | Depends | Wave | Files | Verifier | Risk | State |\n|---|---|---|---|---|---|---|---|---|---|\n';
  const row = (id, cap, deps, wave, files, state) => `| ${id} | do ${id} | ${cap} | x | ${deps} | ${wave} | ${files} | npm test | low | ${state} |\n`;
  const ids = reg.capabilities.map((c) => c.id);
  const ok = checkPlan(parsePlan(header + row('T-1', 'backend', '-', 1, 'src/api/**', 'DONE') + row('T-2', 'frontend', 'T-1', 2, 'src/web/**', 'READY') + row('T-3', 'qa', 'T-1', 2, 'e2e/**', 'READY')).tasks, ids);
  expect('plan: valid DAG passes with frontier', ok.errors.length === 0 && ok.frontier.join() === 'T-2,T-3', JSON.stringify(ok));
  // A missed cycle can recurse without end: catch it so it fails this test instead of crashing the suite.
  let cyc;
  try { cyc = checkPlan(parsePlan(header + row('T-1', 'backend', 'T-2', 1, 'a/**', 'READY') + row('T-2', 'backend', 'T-1', 2, 'b/**', 'READY')).tasks, ids); } catch (e) { cyc = { errors: [`threw: ${e.message}`] }; }
  expect('plan: cycle detected', cyc.errors.some((e) => e.startsWith('cycle')), JSON.stringify(cyc.errors));
  const overlapPlan = checkPlan(parsePlan(header + row('T-1', 'backend', '-', 1, 'src/**', 'READY') + row('T-2', 'frontend', '-', 1, 'src/web/**', 'READY')).tasks, ids);
  expect('plan: same-wave file overlap rejected', overlapPlan.errors.some((e) => /share file scope/.test(e)));
  const bad = checkPlan(parsePlan(header + row('T-1', 'wizardry', 'T-9', 1, 'a/**', 'DOING') + row('T-2', 'backend', 'T-1', 2, 'b/**', 'RUNNING')).tasks, ids);
  expect('plan: unknown capability/dep/state and premature RUNNING', ['unknown capability', 'unknown T-9', 'state "DOING"', 'is RUNNING but dependency'].every((k) => bad.errors.some((e) => e.includes(k))), JSON.stringify(bad.errors));
  expect('plan: missing columns reported', /missing column/.test(parsePlan('| ID | Objective |\n|---|---|\n| T-1 | x |').error || ''));

  // ---------- V3: router (dimensions, required-first staffing, registry-driven reviewers) ----------
  const dimsRoute = route({ request: 'add login', scope: 'small', dims: { 'security-sensitivity': 'high', 'data-sensitivity': 'medium' }, flags: ['auth'] }, reg);
  expect('route v3: risk = highest dimension, drivers named', dimsRoute.risk === 'high' && dimsRoute.drivers.join() === 'security-sensitivity', JSON.stringify(dimsRoute));
  expect('route v3: understated --risk rejected', throws(() => route({ request: 'x', scope: 'small', risk: 'low', dims: { 'blast-radius': 'high' } }, reg)));
  expect('route v3: unknown dimension rejected', throws(() => riskFromDims({ vibes: 'high' }, null, reg)));
  expect('route v3: --risk above the dims is kept', riskFromDims({ 'blast-radius': 'low' }, 'medium', reg).risk === 'medium');
  const aiSmall = route({ request: 'add a react component that shows sentiment from the llm', scope: 'small', dims: { 'external-exposure': 'medium' }, flags: ['ai'] }, reg);
  expect('route v3: mandatory capability takes the single SMALL slot (A-03)', aiSmall.staffed.length === 1 && aiSmall.staffed[0].id === 'ai-ml', JSON.stringify(aiSmall.staffed));
  const uiSmall = route({ request: 'add an empty state to the notes list page component', scope: 'small', risk: 'low', flags: ['ui'] }, reg);
  expect('route v3: mandatory capability not allowed at the class is reported uncovered, not staffed', uiSmall.uncovered.includes('ux') && uiSmall.staffed.every((s) => s.id !== 'ux'), JSON.stringify(uiSmall));
  expect('route v3: reviewers carry their skill from the registry', dimsRoute.reviewers.find((r) => r.id === 'appsec')?.skill === 'eng-secreview' && dimsRoute.reviewers.find((r) => r.id === 'code-review')?.skill === 'eng-review', JSON.stringify(dimsRoute.reviewers));
  expect('route v3: reviewer capabilities are never staffed as builders', !route({ request: 'code review security review', scope: 'large', risk: 'high', flags: ['auth', 'pii'] }, reg).staffed.some((s) => reg.capabilities.find((c) => c.id === s.id).reviewer_gate));
  expect('route v3: model comes from the tier map', dimsRoute.staffed.every((s) => ['haiku', 'sonnet', 'opus'].includes(s.model)));
  expect('route v3: class gates listed (SMALL: acceptance criteria; MEDIUM: + plan)', dimsRoute.gates.join() === 'acceptance_criteria' && route({ request: 'x', scope: 'medium', risk: 'low' }, reg).gates.join() === 'acceptance_criteria,plan_complete');

  // ---------- V3: plan contract (owner, DoR, DoD, retry budget, V2 compatibility) ----------
  const h3 = '_Class: SMALL_\n| ID | Objective | Capability | Owner | Depends | Wave | Files | AC | Verifier | Risk | Attempts | Evidence | State |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  const r3 = (id, cap, owner, ac, attempts, evidence, state, deps = '-', wave = 1, files = `src/${id}/**`) => `| ${id} | do ${id} | ${cap} | ${owner} | ${deps} | ${wave} | ${files} | ${ac} | npm test | low | ${attempts} | ${evidence} | ${state} |\n`;
  const planRoot = fixture('planroot', { '.eng/evidence/verify-1/summary.json': '{}' });
  const p3 = (rows) => { const p = parsePlan(h3 + rows); return checkPlan(p.tasks, ids, { registry: reg, root: planRoot, cls: p.cls }); };
  expect('plan v3: valid V3 table passes without migration warning', (() => { const r = p3(r3('T-1', 'backend', 'engineering-os:backend-engineer', 'AC-1', 1, '.eng/evidence/verify-1/summary.json', 'DONE') + r3('T-2', 'frontend', 'orchestrator', 'AC-2', 0, '-', 'READY', 'T-1', 2)); return r.errors.length === 0 && !r.warnings.some((w) => /V2 plan/.test(w)); })());
  expect('plan v3: owner must match the capability agent', p3(r3('T-1', 'backend', 'engineering-os:frontend-engineer', 'AC-1', 0, '-', 'READY')).errors.some((e) => /owner .* doesn't match/.test(e)));
  expect('plan v3: Definition of Ready needs AC ids', p3(r3('T-1', 'backend', 'orchestrator', '-', 0, '-', 'READY')).errors.some((e) => /no acceptance criteria/.test(e)));
  expect('plan v3: DONE without evidence rejected', p3(r3('T-1', 'backend', 'orchestrator', 'AC-1', 1, '-', 'DONE')).errors.some((e) => /DONE without evidence/.test(e)));
  expect('plan v3: DONE with a missing evidence path rejected', p3(r3('T-1', 'backend', 'orchestrator', 'AC-1', 1, '.eng/evidence/nope/summary.json', 'DONE')).errors.some((e) => /does not exist/.test(e)));
  expect('plan v3: attempts over the class retry budget while RUNNING rejected', p3(r3('T-1', 'backend', 'orchestrator', 'AC-1', 3, '-', 'RUNNING')).errors.some((e) => /exceed the retry budget \(2\)/.test(e)));
  expect('plan v3: over budget but FAILED is allowed', p3(r3('T-1', 'backend', 'orchestrator', 'AC-1', 3, '-', 'FAILED')).errors.length === 0);
  expect('plan v3: V2 tables still pass, with a migration warning', ok.errors.length === 0 && ok.warnings.some((w) => /V2 plan format/.test(w)));

  // ---------- V3: content fingerprint ----------
  const fpRepo = fixture('fp', { 'src/a.js': 'a\n', 'README.md': '# r\n', '.gitignore': 'ignored/\n.eng/\n' });
  initRepo(fpRepo);
  const f0 = sourceFingerprint(fpRepo);
  writeFileSync(join(fpRepo, 'src', 'a.js'), 'b\n');
  const f1 = sourceFingerprint(fpRepo);
  git(fpRepo, 'commit', '-qam', 'change');
  const f2 = sourceFingerprint(fpRepo);
  writeFileSync(join(fpRepo, 'README.md'), '# docs only\n');
  mkdirSync(join(fpRepo, 'ignored'), { recursive: true });
  writeFileSync(join(fpRepo, 'ignored', 'x.js'), 'x\n');
  const f3 = sourceFingerprint(fpRepo);
  writeFileSync(join(fpRepo, 'src', 'new.js'), 'n\n');
  const f4 = sourceFingerprint(fpRepo);
  expect('fingerprint: source edit changes it', f0 && f1 && f0 !== f1, `${f0} ${f1}`);
  expect('fingerprint: committing the same content does not', f1 === f2, `${f1} ${f2}`);
  expect('fingerprint: docs and ignored files do not', f2 === f3, `${f2} ${f3}`);
  expect('fingerprint: an untracked source file does', f3 !== f4);
  const indexPath = join(fpRepo, '.git', 'index');
  const indexBefore = readFileSync(indexPath);
  sourceFingerprint(fpRepo);
  expect('fingerprint: real index untouched (byte for byte)', Buffer.compare(indexBefore, readFileSync(indexPath)) === 0);
  mkdirSync(join(fpRepo, 'docs'), { recursive: true });
  writeFileSync(join(fpRepo, 'docs', 'résumé.md'), 'é\n');
  expect('fingerprint fix R-11: a non-ASCII docs path does not change it', sourceFingerprint(fpRepo) === f4);
  // R-3: an entry stat-cached in the same second the index was written is "racily clean"; git re-checks its
  // content only if the temp index keeps the real index's mtime. Simulated deterministically with utimes.
  const rc = fixture('fprace', { 'src/x.js': 'a\n' });
  initRepo(rc);
  const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 10_000);
  utimesSync(join(rc, 'src', 'x.js'), T, T);
  git(rc, 'update-index', '--refresh');
  utimesSync(join(rc, '.git', 'index'), T, T);
  writeFileSync(join(rc, 'src', 'x.js'), 'b\n');
  utimesSync(join(rc, 'src', 'x.js'), T, T);
  const rcRef = fixture('fprace-ref', { 'src/x.js': 'b\n' });
  initRepo(rcRef);
  expect('fingerprint fix R-3: a same-size edit in the index-write second is seen', sourceFingerprint(rc) === sourceFingerprint(rcRef), `${sourceFingerprint(rc)} ${sourceFingerprint(rcRef)}`);
  expect('fingerprint: null outside a git repo (callers fall back to mtime)', sourceFingerprint(fixture('nogit', { 'a.js': 'x' })) === null);

  // ---------- V3: verifier evidence, CI-bypass and supply-chain detection ----------
  const v3 = fixture('v3', {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test', lint: 'node -e "process.exit(0)"' } }, null, 2),
    'package-lock.json': '{}',
    'src/a.js': 'export const a = 1;\n',
    'test/a.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a', () => assert.equal(1, 1));\n",
    '.gitignore': '.eng/\n',
    'docs/engineering/project-profile.json': JSON.stringify({ checks: [{ id: 'test', kind: 'test', cmd: 'node --test', cwd: '.' }], overrides: { notApplicable: { typecheck: 'plain JavaScript, no types' } } }),
    'jest.config.js': 'module.exports = { coverageThreshold: { global: { lines: 90 } } };\n',
  });
  initRepo(v3);
  s = verify(v3, { level: 'targeted', task: 'T-7' });
  const latest = JSON.parse(readFileSync(join(v3, '.eng', 'evidence', 'verify-latest.json'), 'utf8'));
  expect('verify v3: evidence schema 2 bound to the fingerprint', latest.schema === 2 && latest.fingerprint === sourceFingerprint(v3) && latest.task === 'T-7' && /^[0-9a-f]{40}$/.test(latest.commit || ''), JSON.stringify(latest).slice(0, 300));
  expect('verify v3: every requested kind recorded (never silently omitted)', ['test', 'typecheck', 'lint'].every((k) => latest.checks.some((c) => c.kind === k)), JSON.stringify(latest.checks));
  expect('verify v3: NOT_APPLICABLE only when declared, with its reason', s.lines.includes('TYPECHECK: NOT_APPLICABLE (plain JavaScript, no types)') && latest.checks.find((c) => c.kind === 'typecheck').status === 'NOT_APPLICABLE', s.lines.join('\n'));
  expect('verify v3: summary.json in the evidence dir agrees', JSON.parse(readFileSync(join(v3, latest.evidence, 'summary.json'), 'utf8')).fingerprint === latest.fingerprint);
  const pkg = JSON.parse(readFileSync(join(v3, 'package.json'), 'utf8'));
  pkg.scripts.test = 'node --test || true';
  pkg.dependencies = { 'left-pad': '^1.3.0' };
  writeFileSync(join(v3, 'package.json'), JSON.stringify(pkg, null, 2));
  writeFileSync(join(v3, 'jest.config.js'), 'module.exports = { coverageThreshold: { global: { lines: 40 } } };\n');
  mkdirSync(join(v3, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(v3, '.github', 'workflows', 'ci.yml'), 'on: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n        continue-on-error: true\n');
  s = verify(v3, { only: ['lint'] });
  const sig = JSON.parse(readFileSync(join(v3, '.eng', 'evidence', 'verify-latest.json'), 'utf8')).signals;
  expect('verify v3: "|| true" on a test command => TESTS-TAMPER FAIL', s.verdict === 'FAIL' && sig.tamper.some((t) => /\|\| true/.test(t)), JSON.stringify(sig.tamper));
  expect('verify v3: continue-on-error added => TESTS-TAMPER FAIL', sig.tamper.some((t) => /continue-on-error/.test(t)));
  expect('verify v3: lowered coverage threshold => WARN', sig.warn.some((w) => /coverage threshold lowered .*90 → 40/.test(w)), JSON.stringify(sig.warn));
  expect('verify v3: unpinned action => SUPPLY-CHAIN WARN', sig.supplyChain.warn.some((w) => /actions\/checkout@v4/.test(w)), JSON.stringify(sig.supplyChain));
  expect('verify v3: manifest changed without its lockfile => WARN', sig.supplyChain.warn.some((w) => /lockfile/.test(w)));
  expect('verify v3: new dependency detected for the new-dependency flag', sig.newDependencies.includes('npm:left-pad'), JSON.stringify(sig.newDependencies));
  writeFileSync(join(v3, '.github', 'workflows', 'pr.yml'), 'on: pull_request_target\njobs:\n  t:\n    permissions: write-all\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n');
  verify(v3, { only: ['lint'] });
  const sc = JSON.parse(readFileSync(join(v3, '.eng', 'evidence', 'verify-latest.json'), 'utf8')).signals.supplyChain;
  expect('verify v3: write-all and pull_request_target + PR-head checkout => SUPPLY-CHAIN FAIL', sc.fail.some((f) => /write-all/.test(f)) && sc.fail.some((f) => /pull_request_target/.test(f)), JSON.stringify(sc));
  expect('verify v3: SHA-pinned action is not flagged', !sc.warn.some((w) => /3d3c42e/.test(w)));

  // ---------- V3 review fixes: router and release ----------
  const tf = route({ request: 'rename the login button label', scope: 'trivial', risk: 'low', flags: ['auth'] }, reg);
  expect('route fix R-18: a risk flag lifts TRIVIAL to SMALL (the gate blocks TRIVIAL with flags)', tf.class === 'SMALL' && tf.reviewers.some((r) => r.id === 'code-review'), JSON.stringify({ c: tf.class, r: tf.reviewers }));
  expect('route fix R-23: --risk is case-insensitive', route({ request: 'x', scope: 'small', risk: 'HIGH' }, reg).risk === 'high');
  const mf = route({ request: 'parse uploaded csv files', scope: 'medium', risk: 'medium', flags: ['external-input'] }, reg);
  expect('route: MEDIUM with a risk flag adds adversarial QA (PROC-6)', mf.reviewers.some((r) => r.id === 'adversarial-qa'), JSON.stringify(mf.reviewers));
  expect('route: MEDIUM without flags has no adversarial QA', !route({ request: 'x', scope: 'medium', risk: 'low' }, reg).reviewers.some((r) => r.id === 'adversarial-qa'));

  // ---------- V3 review fixes: verifier ----------
  const rv = fixture('rv', {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
    'src/s.js': 'export const s = (x) => x;\n',
    'test/s.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { s } from '../src/s.js';\ntest('identity', () => assert.equal(s(1), 1));\ntest('other', () => assert.equal(s(2), 2));\n",
    '.gitignore': '.eng/\n',
  });
  initRepo(rv);
  const startHead = git(rv, 'rev-parse', 'HEAD').stdout.trim();
  mkdirSync(join(rv, '.eng', 'state'), { recursive: true });
  writeFileSync(join(rv, '.eng', 'state', 'session-s1.json'), JSON.stringify({ head: startHead, at: Date.now() }));
  writeFileSync(join(rv, 'test', 's.test.js'), readFileSync(join(rv, 'test', 's.test.js'), 'utf8').replace("test('other'", "test.skip('other'"));
  git(rv, 'commit', '-qam', 'skip a test');
  s = verify(rv, { level: 'targeted' });
  expect('verify fix R-1: on the default branch, committed work is diffed against the session start, not HEAD', s.base === startHead && s.signals.tamper.some((t) => /skip/.test(t)) && s.verdict === 'FAIL', `${s.base} ${JSON.stringify(s.signals?.tamper)}`);
  const en = fixture('enoent', { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }) });
  initRepo(en);
  writeFileSync(join(en, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.error(\'Error: ENOENT: no such file or directory, open fixture.json\'); process.exit(1)"' } }));
  s = verify(en, { only: ['test'] });
  expect('verify fix R-2: a failing test that mentions ENOENT is FAIL, not NOT_RUN', s.results[0]?.status === 'FAIL' && s.verdict === 'FAIL', JSON.stringify(s.results));
  s = verify(rv, { level: 'targeted', skip: ['test'] });
  expect('verify fix R-9: --skip is recorded as partial and reported as skipped', s.partial === true && s.lines.some((l) => /^TESTS: NOT_RUN \(skipped/.test(l)), s.lines.join('\n'));
  s = verify(`${rv}/`, { only: ['lint'] });
  expect('verify fix R-15: evidence path stays relative with a trailing slash', !s.evidence.startsWith('/') && s.evidence.startsWith('.eng/evidence/verify-'), s.evidence);
  const pe = fixture('preexisting-node', {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
    'test/x.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('broken', () => assert.equal(1, 2));\n",
  });
  initRepo(pe);
  const peBase = git(pe, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(pe, 'README.md'), '# readme\n');
  writeFileSync(join(pe, 'extra.js'), 'export const e = 1;\n');
  s = verify(pe, { only: ['test'], base: peBase });
  // Windows CI (746cd61): node prints locations as escaped strings and %-encoded file URLs; both must fold to <root>.
  const winOut = (r) => `not ok 1 - broken\n  location: '${r.replaceAll('\\', '\\\\')}\\\\test\\\\x.test.js:3:1'\n  at TestContext.<anonymous> (file:///${r.replaceAll('\\', '/').replace('~', '%7E')}/test/x.test.js:3:30)\n  duration_ms: 1.23\n`;
  const nRoot = normalize(winOut('C:\\Users\\RUNNER~1\\Temp\\proj'), 'C:\\Users\\RUNNER~1\\Temp\\proj');
  const nBase = normalize(winOut('C:\\Users\\RUNNER~1\\Temp\\proj\\.eng\\baseline\\wt-1'), 'C:\\Users\\RUNNER~1\\Temp\\proj\\.eng\\baseline\\wt-1');
  expect('verify fix: Windows paths (escaped and file:// URL) normalize equally in project and baseline', [...nRoot].every((l) => nBase.has(l)), JSON.stringify([...nRoot].filter((l) => !nBase.has(l))));
  expect('verify fix R-16: node --test duration lines do not hide a pre-existing failure', s.results[0]?.status === 'PRE_EXISTING', JSON.stringify(s.results[0]?.tail));

  // ---------- V3: release readiness ----------
  const rp = (rows, approval = '<who, when>', target = 'production', post = '') => `# Release Plan — 1.2.0 → ${target}\n_Owner: x · Human approval: ${approval}_\n\n## Readiness checklist (every line needs evidence)\n| Item | Status | Evidence |\n|---|---|---|\n${rows}\n## Post-deploy verification\n| Check | Expected | Actual |\n|---|---|---|\n${post}`;
  const good = '| Tests green | PASS | CI run 42 |\n| Migrations | N/A | no schema change |\n';
  expect('release: PASS rows with evidence + named approval => READY', checkRelease(rp(good, 'Sam, 2026-10-02')).ready);
  expect('release: production without a named approval => NOT_READY', checkRelease(rp(good)).gaps.some((g) => /human approval/.test(g)));
  expect('release: staging needs no approval', checkRelease(rp(good, '<who, when>', 'staging')).ready);
  expect('release: empty status or PASS without evidence => gaps', checkRelease(rp('| Tests | PASS | |\n| Monitoring | | |\n', 'Sam')).gaps.length === 2);
  expect('release: post-deploy stage needs actual values, none failing', checkRelease(rp(good, 'Sam', 'production', '| Smoke | pass | pass |\n| Errors | ≤1% | FAILED 7% |\n'), { stage: 'post-deploy' }).gaps.some((g) => /Errors/.test(g)));
  const envDir = fixture('envcheck', { '.env': 'API_KEY=sekret-value\nEMPTY=\n', '.env.example': 'ONLY_EXAMPLE=x\n' });
  const env = envPresence(envDir, ['API_KEY', 'EMPTY', 'ONLY_EXAMPLE']);
  expect('release: env presence by name, never value; example files ignored', env.map((e) => e.status).join() === 'PRESENT,MISSING,MISSING' && !JSON.stringify(env).includes('sekret'), JSON.stringify(env));
  const relOk = (approval) => checkRelease(rp('| Tests | PASS | `npm test` 12 passed |\n', approval)).ready;
  expect('release fix R-19: TBD / pending / none is not a named approval', !relOk('TBD') && !relOk('pending') && !relOk('none') && relOk('Dana Lee, 2026-10-02'));
  const postOk = (actual) => checkRelease(rp('| Tests | PASS | `npm test` 12 passed |\n', 'Dana Lee, 2026-10-02', 'production', `| Error rate | < 1% | ${actual} |\n`), { stage: 'post-deploy' }).ready;
  expect('release fix R-19: "0.1% (errors flat)" is not a failure', postOk('0.1% (errors flat)'));
  expect('release fix R-19: a failing actual is a gap', !postOk('FAIL: 7% 5xx') && !postOk('regressed to 7%'));

  // ---------- V3: telemetry metrics ----------
  const mt = metrics([{ event: 'route', class: 'SMALL' }, { event: 'spawn', agent: 'code-reviewer', agent_id: 'a1' }, { event: 'spawn', agent: 'debugger', agent_id: 'a2' }, { event: 'handoff', agent: 'code-reviewer', agent_id: 'a1', status: 'PASS', accepted: true }, { event: 'verify', verdict: 'FAIL', tamper: 1 }, { event: 'gate', result: 'block', missing: ['review'] }, { event: 'guard', decision: 'deny' }]);
  expect('metrics: spawns per request, active agents, failures, gate reasons', mt.agentsPerRequest === 2 && mt.activeAgents.join() === 'debugger' && mt.verifyFailures === 1 && mt.tamperFindings === 1 && mt.gateBlockReasons.review === 1 && mt.guardDenies === 1, JSON.stringify(mt));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${count - failures}/${count} engine tests passed`);
process.exit(failures ? 1 : 0);
