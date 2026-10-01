#!/usr/bin/env node
// Tests for the deterministic engines: yaml-lite, router, project adapter, verifier, plan checker.
// Run: node scripts/test-engines.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml } from './lib/yaml-lite.mjs';
import { classify, route, loadRegistry } from './eng-route.mjs';
import { detect } from './eng-detect.mjs';
import { verify } from './eng-verify.mjs';
import { parsePlan, checkPlan } from './eng-plan-check.mjs';

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
  writeFileSync(join(app, 'test', 'sum.test.js'), readFileSync(join(app, 'test', 'sum.test.js'), 'utf8').replace("test('zero', () => assert.equal(sum(0, 0), 0));\n", ''));
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

  // ---------- plan checker ----------
  const header = '| ID | Objective | Capability | Owner | Depends | Wave | Files | Verifier | Risk | State |\n|---|---|---|---|---|---|---|---|---|---|\n';
  const row = (id, cap, deps, wave, files, state) => `| ${id} | do ${id} | ${cap} | x | ${deps} | ${wave} | ${files} | npm test | low | ${state} |\n`;
  const ids = reg.capabilities.map((c) => c.id);
  const ok = checkPlan(parsePlan(header + row('T-1', 'backend', '-', 1, 'src/api/**', 'DONE') + row('T-2', 'frontend', 'T-1', 2, 'src/web/**', 'READY') + row('T-3', 'qa', 'T-1', 2, 'e2e/**', 'READY')).tasks, ids);
  expect('plan: valid DAG passes with frontier', ok.errors.length === 0 && ok.frontier.join() === 'T-2,T-3', JSON.stringify(ok));
  const cyc = checkPlan(parsePlan(header + row('T-1', 'backend', 'T-2', 1, 'a/**', 'READY') + row('T-2', 'backend', 'T-1', 2, 'b/**', 'READY')).tasks, ids);
  expect('plan: cycle detected', cyc.errors.some((e) => e.startsWith('cycle')), JSON.stringify(cyc.errors));
  const overlapPlan = checkPlan(parsePlan(header + row('T-1', 'backend', '-', 1, 'src/**', 'READY') + row('T-2', 'frontend', '-', 1, 'src/web/**', 'READY')).tasks, ids);
  expect('plan: same-wave file overlap rejected', overlapPlan.errors.some((e) => /share file scope/.test(e)));
  const bad = checkPlan(parsePlan(header + row('T-1', 'wizardry', 'T-9', 1, 'a/**', 'DOING') + row('T-2', 'backend', 'T-1', 2, 'b/**', 'RUNNING')).tasks, ids);
  expect('plan: unknown capability/dep/state and premature RUNNING', ['unknown capability', 'unknown T-9', 'state "DOING"', 'is RUNNING but dependency'].every((k) => bad.errors.some((e) => e.includes(k))), JSON.stringify(bad.errors));
  expect('plan: missing columns reported', /missing column/.test(parsePlan('| ID | Objective |\n|---|---|\n| T-1 | x |').error || ''));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${count - failures}/${count} engine tests passed`);
process.exit(failures ? 1 : 0);
