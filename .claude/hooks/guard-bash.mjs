#!/usr/bin/env node
// PreToolUse(Bash|PowerShell): deny catastrophic commands; send destructive, irreversible, or
// secret-exposing commands to the human via permissionDecision "ask" (headless sessions refuse).
// A heuristic safety net, not a sandbox: it parses quotes, heredocs, chains, pipes, subshells,
// `sh -c` / `pwsh -Command` payloads, and xargs, then applies per-segment checks.
import { readInput, decide, isSecretPath, mentionsSecretPath, findSecret } from './lib.mjs';

const denyReasons = new Set();
const askReasons = new Set();
const activeSegments = []; // text of segments that execute something (not read-only, not prose)

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const POWERSHELLS = new Set(['pwsh', 'powershell']);
const INTERPRETERS = new Set([...SHELLS, ...POWERSHELLS, 'python', 'python3', 'node', 'ruby', 'perl', 'psql', 'mysql', 'mariadb',
  'sqlite3', 'mongosh', 'mongo', 'redis-cli', 'cqlsh', 'clickhouse-client']);
const PREFIXES = new Set(['sudo', 'doas', 'command', 'exec', 'env', 'time', 'nohup', 'nice', '&', '!', '(', '{']);
const READ_ONLY = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ls', 'tree', 'wc',
  'diff', 'cmp', 'file', 'stat', 'du', 'df', 'jq', 'yq', 'which', 'where', 'pwd', 'realpath', 'basename', 'dirname', 'sort', 'uniq',
  'cut', 'tr', 'column', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'md5sum', 'sha1sum', 'sha256sum', 'awk', 'get-content', 'gc', 'type',
  'select-string', 'sls', 'get-childitem', 'gci', 'dir', 'test-path', 'get-item', 'measure-object']);
const GIT_READ_ONLY = new Set(['log', 'show', 'diff', 'status', 'blame', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'describe',
  'shortlog', 'merge-base', 'cat-file', 'check-ignore']);
const SECRET_SAFE = new Set(['source', '.', 'ls', 'stat', 'test', '[', 'touch', 'chmod', 'chown', 'cp', 'mv', 'echo', 'printf',
  'docker', 'docker-compose', 'podman', 'dotenv', 'test-path', 'get-item', 'copy-item', 'move-item']);

// ---------- lexing ----------
function lex(src) {
  const segs = [];
  let cur = '';
  let quote = null;
  let op = null;
  let pending = [];
  const flush = (nextOp) => {
    const text = cur.trim();
    if (text) segs.push({ text, heredoc: '', pipedIn: op === '|' });
    cur = '';
    op = nextOp;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < src.length) cur += src[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '\\' && i + 1 < src.length && /[;&|\n]/.test(src[i + 1])) { cur += c + src[++i]; continue; }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = src.slice(i).match(/^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
      if (m) { pending.push(m[2]); cur += m[0]; i += m[0].length - 1; continue; }
    }
    if (c === '\n') {
      flush(';');
      if (pending.length) {
        const seg = segs[segs.length - 1];
        let rest = src.slice(i + 1);
        for (const delim of pending) {
          const end = rest.match(new RegExp(`^[\\t ]*${delim}[\\t ]*$`, 'm'));
          if (seg) seg.heredoc += end ? rest.slice(0, end.index) : rest;
          rest = end ? rest.slice(end.index + end[0].length) : '';
        }
        i = src.length - rest.length - 1;
        pending = [];
      }
      continue;
    }
    if (c === '&' && src[i + 1] === '&') { flush('&&'); i++; continue; }
    if (c === '|' && src[i + 1] === '|') { flush('||'); i++; continue; }
    if (c === '|') { flush('|'); continue; }
    if (c === ';') { flush(';'); continue; }
    if (c === '&' && src[i - 1] !== '>' && src[i + 1] !== '>') { flush('&'); continue; }
    cur += c;
  }
  flush(null);
  return segs;
}

// Whitespace split outside quotes; quotes removed; backslashes kept literal (Windows paths).
function tokenize(text) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && text[i + 1] === '"') cur += text[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) out.push(cur); cur = ''; started = false; continue; }
    cur += c;
    started = true;
  }
  if (started) out.push(cur);
  let i = 0;
  while (i < out.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(out[i]) || PREFIXES.has(out[i]) || (out[i - 1] === 'env' && out[i].startsWith('-')))) i++;
  const t = out.slice(i);
  if (t[0]) t[0] = t[0].replace(/^[({!]+/, '');
  return t;
}

const headOf = (tok) => (tok || '').replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.exe$/, '');
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;

// ---------- recursive deletes ----------
const SYSTEM_DIRS = new Set(['bin', 'boot', 'dev', 'etc', 'lib', 'lib32', 'lib64', 'opt', 'proc', 'sbin', 'srv', 'sys', 'usr', 'var',
  'system', 'applications', 'library', 'windows', 'program files', 'program files (x86)', 'programdata']);
const HOME = /^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%|\/root)$/i;

function classifyTarget(raw) {
  let t = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\)+$/, '');
  if (/^\/+\*?$/.test(t)) return 'deny';
  t = t.replace(/(\/\*)+$/, '').replace(/\/+$/, '').replace(/^\.\/(?=.)/, '');
  const lower = t.toLowerCase();
  if (HOME.test(lower)) return 'deny';
  if (/^[a-z]:$/i.test(t)) return 'deny';
  const parts = lower.replace(/^[a-z]:/, '').split('/').filter(Boolean);
  const absolute = t.startsWith('/') || /^[a-z]:\//i.test(t);
  if (absolute) {
    if (['home', 'users'].includes(parts[0]) && parts.length <= 2) return 'deny';
    if (SYSTEM_DIRS.has(parts[0]) && (parts.length === 1 || ['windows', 'program files', 'program files (x86)'].includes(parts[0]))) return 'deny';
    if (parts.length <= 2) return 'ask';
  }
  if (HOME.test(parts[0] || '') && parts.length <= 2) return 'ask';
  if (['.', '..', '*', '.git', '$claude_project_dir', '${claude_project_dir}', '$pwd', '${pwd}', '$env:claude_project_dir'].includes(lower)) return 'ask';
  return null;
}

function checkDelete(head, args, fromStdin) {
  let recursive = false;
  let targets = [];
  if (head === 'rm') {
    recursive = args.some((a) => a === '--recursive' || (/^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a)));
    targets = args.filter((a) => !a.startsWith('-'));
  } else if (['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'].includes(head)) {
    recursive = args.some((a) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(a) || /^\/s$/i.test(a));
    targets = args.filter((a) => !a.startsWith('-') && !/^\/[a-z]$/i.test(a));
  }
  if (!recursive) return;
  if (fromStdin && targets.every((t) => t === '{}')) askReasons.add('recursive delete with targets read from stdin');
  for (const target of targets) {
    const verdict = classifyTarget(target);
    if (verdict === 'deny') denyReasons.add(`recursive delete of "${target}"`);
    else if (verdict === 'ask') askReasons.add(`recursive delete of "${target}" (repo root, .git, wildcard, home subfolder, or top-level dir)`);
  }
}

// ---------- git ----------
const PROTECTED = /(?:^|[\s:/+])(main|master|prod|production|release[\w./-]*|trunk)(?:\s|$)/;
function checkGit(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i]) ? 2 : 1;
  const sub = args[i] || '';
  const a = args.slice(i + 1);
  const has = (re) => a.some((x) => re.test(x));
  const shortHas = (letter) => a.some((x) => /^-[a-zA-Z]+$/.test(x) && x.includes(letter));
  if (sub === 'push') {
    if (has(/^(--force|--mirror)$/) || shortHas('f') || has(/^\+\S+/)) askReasons.add('force push (rewrites remote history)');
    else if (has(/^--force-with-lease/) && PROTECTED.test(` ${a.join(' ')} `)) askReasons.add('force push to a protected branch');
    if (has(/^--delete$/) || shortHas('d') || has(/^:\S+/)) askReasons.add('deleting a remote branch or tag');
  }
  if (sub === 'reset' && has(/^--hard$/)) askReasons.add('git reset --hard discards uncommitted work (prefer `git stash -u`)');
  if (sub === 'clean' && (has(/^--force$/) || shortHas('f'))) askReasons.add('git clean --force deletes untracked (and possibly ignored) files');
  if ((sub === 'checkout' || sub === 'restore') && !has(/^--staged$/) && has(/^(\.|\.\/|:\/|\*|:\/\.)$/))
    askReasons.add(`git ${sub} of the whole tree discards uncommitted work`);
  if (sub === 'checkout' && (has(/^--force$/) || shortHas('f'))) askReasons.add('git checkout --force discards uncommitted work');
  if (sub === 'branch' && (shortHas('D') || ((has(/^--delete$/) || shortHas('d')) && (has(/^--force$/) || shortHas('f')))))
    askReasons.add('force-deleting a branch (use -d)');
  if (sub === 'stash' && ['clear', 'drop'].includes(a[0])) askReasons.add(`git stash ${a[0]} destroys stashed work`);
  if (['filter-branch', 'filter-repo'].includes(sub)) askReasons.add('history rewrite');
  if (sub === 'reflog' && a[0] === 'expire') askReasons.add('expiring the reflog removes recovery points');
  if (sub === 'gc' && has(/^--prune=now$/)) askReasons.add('git gc --prune=now removes recovery points');
  if (['commit', 'push', 'merge', 'rebase', 'am', 'cherry-pick'].includes(sub) && has(/^--no-verify$/)) askReasons.add('--no-verify skips hooks');
  if (sub === 'commit' && shortHas('n')) askReasons.add('git commit -n skips hooks');
  if (sub === 'add' && a.some((x) => isSecretPath(x))) askReasons.add('staging a secrets file');
  return sub;
}

// ---------- per-segment analysis ----------
function analyze(src, depth = 0) {
  if (depth > 4 || !src || !src.trim()) return;
  for (const m of src.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) analyze(m[1] ?? m[2], depth + 1);
  const segs = lex(src);
  segs.forEach((seg, idx) => {
    const t = tokenize(seg.text);
    if (!t.length) return;
    const head = headOf(t[0]);
    const args = t.slice(1);
    const prev = segs[idx - 1];
    const prevPayload = prev && seg.pipedIn ? tokenize(prev.text).slice(1).join(' ') + '\n' + prev.heredoc : '';

    // Payloads executed by shells.
    if (SHELLS.has(head)) {
      const ci = args.findIndex((a) => /^-[a-z]*c$/.test(a));
      if (ci >= 0) analyze(args[ci + 1] || '', depth + 1);
      else {
        analyze(seg.heredoc, depth + 1);
        if (prev && seg.pipedIn) {
          const ph = headOf(tokenize(prev.text)[0]);
          if (['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'].includes(ph))
            askReasons.add('piping a remote script into a shell (supply-chain risk)');
          else analyze(prevPayload, depth + 1);
        }
      }
    }
    if (POWERSHELLS.has(head)) {
      const ci = args.findIndex((a) => /^-(c|command|encodedcommand|e|ec)$/i.test(a));
      if (ci >= 0) {
        const payload = args.slice(ci + 1).join(' ');
        if (/^-(encodedcommand|e|ec)$/i.test(args[ci])) {
          try { analyze(Buffer.from(payload, 'base64').toString('utf16le'), depth + 1); } catch { askReasons.add('encoded PowerShell command'); }
        } else analyze(payload, depth + 1);
      }
    }
    if (head === 'xargs') {
      let j = 0;
      while (j < args.length && args[j].startsWith('-')) j += ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a'].includes(args[j]) ? 2 : 1;
      const inner = args.slice(j);
      if (inner.length) checkDelete(headOf(inner[0]), inner.slice(1), true);
    }

    checkDelete(head, args, false);
    const gitSub = head === 'git' ? checkGit(args) : '';

    const prose = ['echo', 'printf', 'write-output', 'write-host'].includes(head) ||
      (head === 'git' && ['commit', 'tag', 'notes'].includes(gitSub)) || (head === 'gh' && ['pr', 'issue', 'release'].includes(args[0]));
    const readOnly = READ_ONLY.has(head) ||
      (head === 'git' && GIT_READ_ONLY.has(gitSub)) ||
      (head === 'find' && !args.some((a) => /^-(delete|exec|execdir|ok|okdir)$/.test(a))) ||
      (head === 'sed' && !args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) ||
      (head === 'kubectl' && ['get', 'describe', 'logs', 'explain', 'top', 'version', 'api-resources'].includes(args[0]));

    // Secrets: commands that could print or ship a secrets file.
    const secretText = prose ? seg.text.replace(QUOTED, ' ') : seg.text;
    const gitSafe = head === 'git' && ['status', 'check-ignore', 'ls-files', 'rm'].includes(gitSub);
    const secret = mentionsSecretPath(secretText);
    if (secret && !SECRET_SAFE.has(head) && !gitSafe && !(head === 'git' && gitSub === 'add'))
      askReasons.add(`command touches the secrets file "${secret}" (contents could reach the transcript)`);
    if (t.length === 1 && /^(printenv|env|export|set)$/.test(head)) askReasons.add('dumping the whole environment (may contain secrets)');
    if (/^(get-childitem|gci|dir|ls)$/.test(head) && args.some((a) => /^env:\\?$/i.test(a))) askReasons.add('dumping the whole environment (may contain secrets)');

    if (!readOnly && !prose) {
      activeSegments.push(seg.text);
      if (INTERPRETERS.has(head) && !SHELLS.has(head) && !POWERSHELLS.has(head)) activeSegments.push(`${seg.heredoc}\n${prevPayload}`);
    }
  });
}

function checkActive() {
  for (const s of activeSegments) {
    if (/\b(drop\s+(database|schema|table)|truncate\s+(table\s+)?\w)/i.test(s)) askReasons.add('destructive SQL (DROP/TRUNCATE)');
    if (/\b(terraform|tofu)\b[^\n]*\b(apply|destroy)\b/.test(s) || /\bpulumi\s+(up|destroy)\b/.test(s)) askReasons.add('infrastructure apply/destroy');
    if (/\bkubectl\b[^\n]*\s(delete|drain)\b/.test(s) || /\bhelm\s+(uninstall|delete)\b/.test(s)) askReasons.add('cluster resource deletion');
    if (/\b(aws|gcloud|az|doctl)\b[^\n]*\s(rm|rb|delete[\w-]*|terminate[\w-]*|remove[\w-]*|purge[\w-]*)(\s|$)/.test(s)) askReasons.add('cloud resource deletion');
    if (/\b(vercel|netlify)\b[^\n]*--prod\b/.test(s) || /\b(fly|flyctl)\s+deploy\b/.test(s)) askReasons.add('production deploy');
    if (/\b(npm|pnpm|yarn|bun)\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b|\bdocker\s+push\b/.test(s))
      askReasons.add('external publish/release');
    if (/\b(iex|invoke-expression)\b[^\n]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b/i.test(s))
      askReasons.add('executing a downloaded script (supply-chain risk)');
    if (/\bmkfs(\.\w+)?\b/.test(s) || /\bdd\b[^\n]*\bof=\/dev\/(?!null\b)/.test(s) || />\s*\/dev\/(sd|nvme|disk|hd)/.test(s)) denyReasons.add('raw disk write/format');
    if (/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?(777|a\+rwx)\s+\/(\s|$)/.test(s)) denyReasons.add('chmod 777 on /');
  }
  const joined = activeSegments.join(' ; ');
  if (/\b(prod|production)\b/i.test(joined) && /\b(deploy|migrate|apply|rollout|scale|delete|destroy|drop|truncate|restart|seed)\b/i.test(joined))
    askReasons.add('mutating command that references production');
}

try {
  const cmd = String(readInput()?.tool_input?.command ?? '');
  if (!cmd.trim()) process.exit(0);
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd)) denyReasons.add('fork bomb');
  analyze(cmd);
  checkActive();
  const leaked = findSecret(cmd);
  if (leaked) askReasons.add(`command contains what looks like a real ${leaked} (reference an environment variable instead)`);
} catch (e) {
  askReasons.add(`guard-bash could not analyze this command (${e?.message || e}); human review required`);
}

const tag = 'guard-bash';
if (denyReasons.size)
  decide('deny', `${tag}: ${[...denyReasons].join('; ')}. Never allowed from an agent; if truly needed, the human must run it manually.`);
if (askReasons.size)
  decide('ask', `${tag}: ${[...askReasons].join('; ')}. Needs explicit human approval (CLAUDE.md → Human decision gates).`);
process.exit(0);
