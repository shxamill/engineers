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

// Exit code 2 = blocking; stderr is fed back to the model.
export function block(reason) {
  process.stderr.write(reason.endsWith('\n') ? reason : `${reason}\n`);
  process.exit(2);
}

export const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

const SAFE_ENV_SUFFIXES = ['example', 'sample', 'template', 'dist', 'defaults', 'schema'];

export function isSecretPath(p) {
  if (!p) return false;
  const name = String(p).replace(/\\/g, '/').replace(/["'`]/g, '').split('/').pop().toLowerCase();
  if (name === '.env') return true;
  if (name.startsWith('.env.')) {
    const suffix = name.slice(5);
    return !SAFE_ENV_SUFFIXES.some((s) => suffix === s || suffix.endsWith(`.${s}`));
  }
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return true;
  return ['credentials.json', 'service-account.json', '.netrc', '.pgpass'].includes(name);
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
