// Shared helpers for hook scripts. Zero dependencies; Node >= 18; Linux/macOS/Windows.
import { readFileSync } from 'node:fs';

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
