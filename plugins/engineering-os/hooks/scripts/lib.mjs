// Shared helpers for hook scripts and engines. Zero dependencies; Node >= 18; Linux/macOS/Windows.
import { readFileSync, copyFileSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Files that never count as "source" for gates, fingerprints, or class sizing.
export const NON_SOURCE = /(^|\/)(docs|\.eng|\.claude|\.github\/ISSUE_TEMPLATE)\/|\.(md|mdx|txt|rst|png|jpe?g|gif|svg|ico|lock)$|(^|\/)(LICENSE|CHANGELOG|\.gitignore)$/i;
export const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e)\/|[._-](test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$/i;

// OS state that only engines and hooks may write: verification evidence (verify-latest.json and verify-*
// run directories), the gate ledger, session state, telemetry. Other files under .eng/evidence/ stay
// writable for scratch logs (constitution: context economy).
export const PROTECTED_STATE = /\.eng[/\\](state([/\\"'\s]|$)|telemetry\.jsonl|evidence[/\\](verify-|gates\.jsonl))|\bgates\.jsonl\b|\bverify-latest\.json\b/i;
export const PROTECTED_HOOKS = /\b(check-handoff|stop-verify)\.mjs\b/i;

// Content fingerprint of the source tree (tracked + untracked, .gitignore respected), independent of
// commits and mtimes: copy the index to a temp file, `git add -A` + `write-tree` into it, hash the
// source entries. The real index is never modified. Returns null outside a git repo or on error.
export function sourceFingerprint(dir) {
  const run = (args, env) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 8000, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } });
  const tmpIndex = join(tmpdir(), `eng-fp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const index = run(['rev-parse', '--git-path', 'index']).trim();
    try { copyFileSync(resolve(dir, index), tmpIndex); } catch {} // no commits/index yet: start empty
    run(['add', '-A'], { GIT_INDEX_FILE: tmpIndex });
    const tree = run(['write-tree'], { GIT_INDEX_FILE: tmpIndex }).trim();
    const entries = run(['ls-tree', '-r', '--full-tree', tree]).split('\n')
      .filter((l) => l && !NON_SOURCE.test(l.slice(l.indexOf('\t') + 1)));
    return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16);
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmpIndex); } catch {}
  }
}

// Append-only local telemetry for the OS itself. Never throws; never records command text or secrets.
export function logEvent(dir, event) {
  try {
    mkdirSync(join(dir, '.eng'), { recursive: true });
    appendFileSync(join(dir, '.eng', 'telemetry.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  } catch {}
}

export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Exit code 2 = blocking; stderr is fed back to the model. Used by non-tool events (SubagentStop).
export function block(reason) {
  process.stderr.write(reason.endsWith('\n') ? reason : `${reason}\n`);
  process.exit(2);
}

// PreToolUse decision. "ask" puts the human in the loop: interactive sessions prompt the user,
// headless sessions refuse; bypassPermissions does not auto-approve it.
export function decide(permissionDecision, reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason } }),
  );
  process.exit(0);
}

export const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Plugin root: two levels above this file (hooks/scripts/lib.mjs), independent of env.
export const pluginRoot = () => fileURLToPath(new URL('../../', import.meta.url));

// "engineering-os:code-reviewer" and "code-reviewer" both name the same org agent.
export const bareAgentName = (name) => String(name || '').split(':').pop();

const SAFE_ENV_SUFFIXES = ['example', 'sample', 'template', 'dist', 'defaults', 'schema'];
const HOME_PREFIX = /^(~|\$home|\$\{home\}|\$env:userprofile|%userprofile%|\/root|\/home\/[^/]+|\/users\/[^/]+|[a-z]:\/users\/[^/]+)$/;

export function isSecretPath(p) {
  if (!p) return false;
  let norm = String(p).replace(/\\/g, '/').replace(/["'`]/g, '').replace(/\/+$/, '').toLowerCase();
  if (!/^[a-z]:\//.test(norm) && !/\$env:/.test(norm) && norm.includes(':')) norm = norm.slice(norm.lastIndexOf(':') + 1); // git <rev>:<path>, scp host:path
  const parts = norm.split('/');
  const name = parts.pop();
  const parent = parts[parts.length - 1] || '';
  if (name === '.env') return true;
  if (name.startsWith('.env.')) {
    const suffix = name.slice(5);
    return !SAFE_ENV_SUFFIXES.some((s) => suffix === s || suffix.endsWith(`.${s}`));
  }
  if (/\.(key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (/\.pem$/.test(name)) return !/(cert|chain|bundle|public|pub[._-]|^ca[._-]|[._-]ca\.|^ca\.pem$|root)/.test(name);
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return true;
  if (['credentials.json', 'service-account.json', '.netrc', '.pgpass', '.git-credentials', '.pypirc'].includes(name)) return true;
  if (name === 'credentials' && parent === '.aws') return true;
  if (name === 'config.json' && parent === '.docker') return true;
  if (name === 'config' && parent === '.kube') return true;
  if (name === 'hosts.yml' && parent === 'gh') return true;
  if (name === '.npmrc') return HOME_PREFIX.test(parts.join('/')); // project .npmrc files are normal config
  return false;
}

// Path-like substrings worth checking with isSecretPath (works inside quotes and code strings).
const SECRET_CANDIDATE =
  /[\w.~$%:\\/@{}-]{0,200}(?:\.env(?:\.[\w.-]+)?|id_(?:rsa|dsa|ecdsa|ed25519)|\.(?:pem|key|p12|pfx|jks|keystore)|credentials(?:\.json)?|service-account\.json|\.netrc|\.pgpass|\.git-credentials|\.npmrc|\.pypirc|\.docker[\\/]config\.json|\.kube[\\/]config|gh[\\/]hosts\.yml)(?![\w-])/gi;

export function mentionsSecretPath(text) {
  for (const m of String(text).matchAll(SECRET_CANDIDATE)) if (isSecretPath(m[0])) return m[0];
  return null;
}

// High-confidence credential formats only; placeholders like "sk_live_xxx" are too short to match.
export const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, 'GitHub fine-grained token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{20,}/, 'Slack token'],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/, 'Stripe live key'],
  [/\bsk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{40,}/, 'Anthropic API key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/, 'OpenAI-style API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
];

export function findSecret(text) {
  if (!text) return null;
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}
