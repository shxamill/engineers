#!/usr/bin/env node
// Mutation check (audit A-17): proves the test suites catch regressions in the OS's safety mechanisms.
// Each mutation disables one mechanism in a temporary copy of the plugin, runs the suite that should
// guard it, and must make that suite FAIL. A mutation whose target text is missing or ambiguous is an
// error too, so this file stays in sync with the code it mutates.
// Usage: node scripts/mutation-check.mjs [--only id1,id2] [--jobs 4]
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = 'scripts/verify-hooks.mjs';
const E = 'scripts/test-engines.mjs';

// [id, file, find, replace, suite, mechanism]
export const MUTATIONS = [
  ['gate-verification', 'hooks/scripts/gates.mjs', "if (!vFresh) add('verification'", "if (false) add('verification'", H, 'completion gate requires verification'],
  ['gate-fingerprint', 'hooks/scripts/gates.mjs', 'e.fingerprint === fp :', 'true :', H, 'evidence bound to the content fingerprint'],
  ['gate-evidence-integrity', 'hooks/scripts/gates.mjs', 'if (!summary || summary.fingerprint !== verify.fingerprint', 'if (false', H, 'verify-latest must agree with its evidence dir'],
  ['gate-reviewer-pass', 'hooks/scripts/gates.mjs', "else if (top.status !== 'PASS')", 'else if (false)', H, 'reviewer verdict must be PASS'],
  ['gate-class-size', 'hooks/scripts/gates.mjs', 'if (impl.length > b.max_impl_files || areas.size > b.max_areas)', 'if (false)', H, 'declared class fits the diff'],
  ['gate-risk-paths', 'hooks/scripts/gates.mjs', 'if (undeclared.length)', 'if (false)', H, 'risk flags fit changed paths'],
  ['gate-acceptance-criteria', 'hooks/scripts/gates.mjs', '!hasAcceptanceCriteria(dir, now.now, changed.all)', 'false', H, 'AC gate for SMALL+'],
  ['gate-plan-in-flight', 'hooks/scripts/gates.mjs', 'else if (open.length)', 'else if (false)', H, 'plan gate for MEDIUM+'],
  ['guard-evidence-shell', 'hooks/scripts/guard-bash.mjs', '      denyReasons.add(EVIDENCE_REASON);\n', '      void 0;\n', H, 'shell cannot write evidence/ledger'],
  ['guard-evidence-tools', 'hooks/scripts/guard-secrets.mjs', 'if (writes && (PROTECTED_STATE.test(canon)', 'if (false && (PROTECTED_STATE.test(canon)', H, 'file tools cannot write evidence/ledger'],
  ['guard-secret-path', 'hooks/scripts/lib.mjs', "if (name === '.env') return true;", "if (name === '.env') return false;", H, 'secret files go to the human'],
  ['guard-catastrophic', 'hooks/scripts/guard-bash.mjs', "denyReasons.add('fork bomb')", 'void 0', H, 'catastrophic commands denied'],
  ['handoff-evidence', 'hooks/scripts/check-handoff.mjs', "if (status[1] === 'PASS') {", 'if (false) {', H, 'PASS requires evidence'],
  ['route-required-first', 'scripts/eng-route.mjs', 'for (const [id, flag] of required) if (!isReviewer(id) && byId.get(id).classes.includes(cls)) staffed.push(', 'for (const [id, flag] of []) if (!isReviewer(id) && byId.get(id).classes.includes(cls)) staffed.push(', E, 'mandatory capability is not displaced'],
  ['route-understated-risk', 'scripts/eng-route.mjs', 'if (declared && RISKS.indexOf(declared) < RISKS.indexOf(computed))', 'if (false)', E, 'declared risk cannot understate dimensions'],
  ['plan-cycle', 'scripts/eng-plan-check.mjs', 'if (visiting.has(id)) {', 'if (false) {', E, 'dependency cycles rejected'],
  ['plan-done-evidence', 'scripts/eng-plan-check.mjs', 'if (EMPTY(t.evidence)) errors.push(', 'if (false) errors.push(', E, 'DONE requires evidence'],
  ['verify-skip-marker', 'scripts/eng-verify.mjs', 'if (a.path && TEST_PATH.test(a.path) && SKIP_MARKER.test(a.text)) tamper.push(', 'if (false) tamper.push(', E, 'added skip/only markers fail'],
  ['verify-ci-bypass', 'scripts/eng-verify.mjs', 'for (const [re, what] of BYPASS) if (re.test(a.text)) tamper.push(', 'for (const [re, what] of BYPASS) if (false) tamper.push(', E, 'CI bypass fails'],
  ['verify-fingerprint', 'scripts/eng-verify.mjs', 'const fingerprint = sourceFingerprint(root);', 'const fingerprint = null;', E, 'evidence records the fingerprint'],
  ['verify-supply-write-all', 'scripts/eng-verify.mjs', 'if (/^\\s*permissions:\\s*write-all\\b/.test(a.text)) supply.fail.push(', 'if (false) supply.fail.push(', E, 'write-all workflow permissions fail'],
  ['release-approval', 'scripts/eng-release-check.mjs', "if (/prod/.test(tgt) && (placeholder(approval)", 'if (false && (placeholder(approval)', E, 'production needs a named approval'],
  // Fresh-context review fixes (R-n): each fix stays guarded by a test.
  ['fingerprint-racy', 'hooks/scripts/lib.mjs', 'utimesSync(tmpIndex, st.atime, st.mtime);', 'void 0;', E, 'same-second edits change the fingerprint (R-3)'],
  ['gate-unfingerprinted', 'hooks/scripts/gates.mjs', 'Boolean(e?.fingerprint) && e.fingerprint === fp', '(!e?.fingerprint || e.fingerprint === fp)', H, 'entries without a fingerprint are never current (R-4)'],
  ['gate-future-ledger', 'hooks/scripts/gates.mjs', '!((g.at || 0) > Date.now() + FUTURE_SLACK_MS)', 'true', H, 'future-dated ledger entries ignored (R-4)'],
  ['gate-verify-level', 'hooks/scripts/gates.mjs', '(LEVEL_RANK[verify.level] || 0) < LEVEL_RANK[b.verify]', 'false', H, 'verification at the class level (R-9)'],
  ['gate-session-branches', 'hooks/scripts/gates.mjs', "if (changed.branches.length && !skipped.has('branches'))", 'if (false)', H, 'work left on another branch is seen (R-5)'],
  ['guard-evidence-vars', 'hooks/scripts/guard-bash.mjs', 'analyze(expandVars(cmd, collectVars(cmd)));', 'analyze(cmd);', H, 'variables are expanded before the evidence check (R-6)'],
  ['guard-evidence-cwd', 'hooks/scripts/guard-bash.mjs', 'if (cwd && !/^([a-z]:)?[\\\\/~]/i.test(w)) cands.push(', 'if (false) cands.push(', H, 'paths relative to an earlier cd are checked (R-5)'],
  ['guard-paths-canonical', 'hooks/scripts/guard-secrets.mjs', 'PROTECTED_STATE.test(canon) ||', 'false ||', H, 'file-tool paths are normalized (R-7)'],
  ['handoff-namespaced', 'hooks/scripts/check-handoff.mjs', "if (!type.startsWith('engineering-os:')) process.exit(0);", 'void 0;', H, 'only plugin agents write the ledger (R-14)'],
  ['verify-session-base', 'scripts/eng-verify.mjs', "if (start && start !== head && git(root, ['merge-base', '--is-ancestor', start, 'HEAD']) !== null) return start;", 'void 0;', E, 'committed work diffed from the session start (R-1)'],
  ['route-trivial-flags', 'scripts/eng-route.mjs', "=== 'TRIVIAL' && flags.length ? 'SMALL'", "=== 'NEVER' && flags.length ? 'SMALL'", E, 'a risk flag lifts TRIVIAL (R-18)'],
];

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, suite)], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function check([id, file, find, replace, suite, what]) {
  const dir = mkdtempSync(join(tmpdir(), `eng-mut-${id}-`));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (src) => !/[/\\](\.eng|evals[/\\]results|node_modules)([/\\]|$)/.test(src) });
    const target = join(dir, file);
    const text = readFileSync(target, 'utf8');
    const hits = text.split(find).length - 1;
    if (hits !== 1) return { id, what, ok: false, detail: `mutation target ${hits === 0 ? 'missing' : `ambiguous (${hits}×)`} in ${file}` };
    writeFileSync(target, text.replace(find, replace));
    const r = await runSuite(dir, suite);
    // Killed only by a failing test (a "FAIL <name>" line); a crash proves nothing about the suite's coverage.
    const firstFail = (r.out.split('\n').find((l) => l.startsWith('FAIL ')) || '').slice(0, 110);
    const killed = r.code !== 0 && Boolean(firstFail);
    const why = r.code !== 0 ? `CRASHED — ${suite} exited ${r.code} without a failing test: ${r.out.trim().split('\n').slice(-1)[0]?.slice(0, 120)}` : `SURVIVED — ${suite} still passes with this mechanism disabled`;
    return { id, what, ok: killed, detail: killed ? firstFail : why };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const only = (val('only') || '').split(',').filter(Boolean);
  const jobs = Math.max(1, Number(val('jobs')) || 4);
  const todo = MUTATIONS.filter((m) => !only.length || only.includes(m[0]));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, async () => {
    while (next < todo.length) results.push(await check(todo[next++]));
  }));
  results.sort((a, b) => todo.findIndex((m) => m[0] === a.id) - todo.findIndex((m) => m[0] === b.id));
  for (const r of results) console.log(`${r.ok ? 'KILLED  ' : 'SURVIVED'} ${r.id.padEnd(26)} ${r.what}${r.ok ? '' : `\n         ${r.detail}`}`);
  const survived = results.filter((r) => !r.ok);
  console.log(`${results.length - survived.length}/${results.length} mutations killed`);
  process.exit(survived.length ? 1 : 0);
}
