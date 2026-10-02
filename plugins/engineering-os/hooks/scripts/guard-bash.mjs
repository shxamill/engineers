#!/usr/bin/env node
// PreToolUse(Bash|PowerShell): deny catastrophic commands; send destructive, irreversible, or
// secret-exposing commands to the human via permissionDecision "ask" (headless sessions refuse).
// A heuristic safety net, not a sandbox. It lexes quotes, escapes, comments, heredocs, chains,
// pipes, $(...) and backticks (never inside single quotes or quoted-delimiter heredocs), recurses
// into sh -c / pwsh -Command / cmd /c / eval payloads and xargs, then applies per-segment checks.
import { readInput, decide, isSecretPath, mentionsSecretPath, findSecret, PROTECTED_STATE, PROTECTED_HOOKS, projectDir, logEvent } from './lib.mjs';

const input = readInput();
const EVIDENCE_REASON = 'writing Engineering OS evidence/state or running its gate hooks by hand (only eng-verify and the hooks write verify evidence, the gate ledger, .eng/state, and telemetry)';
const PS = input?.tool_name === 'PowerShell'; // PowerShell: backslash is literal, backtick escapes
const denyReasons = new Set();
const askReasons = new Set();
const activeSegments = []; // segments that execute something (not read-only, not prose)

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const POWERSHELLS = new Set(['pwsh', 'powershell']);
const INTERPRETERS = new Set([...SHELLS, ...POWERSHELLS, 'python', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'psql',
  'mysql', 'mariadb', 'sqlite3', 'mongosh', 'mongo', 'redis-cli', 'cqlsh', 'clickhouse-client']);
const SIMPLE_PREFIX = new Set(['command', 'builtin', 'exec', 'time', 'nohup', 'noglob', '!', '&', 'if', 'then', 'do', 'else', 'elif', 'while', 'until']);
const READ_ONLY = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ls', 'tree', 'wc',
  'diff', 'cmp', 'file', 'stat', 'du', 'df', 'jq', 'yq', 'which', 'where', 'pwd', 'realpath', 'basename', 'dirname', 'sort', 'uniq',
  'cut', 'tr', 'column', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'md5sum', 'sha1sum', 'sha256sum', 'awk', 'get-content', 'gc', 'type',
  'select-string', 'sls', 'get-childitem', 'gci', 'dir', 'test-path', 'get-item', 'measure-object', 'test', '[', '[[']);
const GREP_FAMILY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'git-grep']);
const GIT_READ_ONLY = new Set(['log', 'show', 'diff', 'status', 'blame', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'describe',
  'shortlog', 'merge-base', 'cat-file', 'check-ignore']);
const SECRET_SAFE = new Set(['source', '.', 'ls', 'stat', 'test', '[', '[[', 'touch', 'chmod', 'chown', 'cp', 'mv', 'echo', 'printf',
  'docker', 'docker-compose', 'podman', 'dotenv', 'ssh', 'scp', 'sftp', 'ssh-add', 'rsync', 'test-path', 'get-item', 'copy-item', 'move-item']);
const HEREDOC = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/;
const NAV = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl']);
const HOOK_RUNNERS = new Set(['node', 'nodejs', 'bun', 'deno']);
const PROFILE = /(^|\/)docs\/engineering\/project-profile\.json$/i;
const PROFILE_REASON = 'changing docs/engineering/project-profile.json (it defines what verification runs and can disable the completion gate)';
// Code that writes: write/append/copy/move/remove calls, open(..., "w"/"a"), or a shell-style > redirect.
// (Not a bare ">": in code that is usually a comparison, and a shell redirect of the outer command is checked as
// a redirect. stdout/stderr writes are output, not file writes.)
const WRITE_HINT = /\b(?<!(?:stdout|stderr)\.)(write\w*|append\w*|unlink\w*|rename\w*|copy\w*|move\w*|remove\w*|truncate|touch|mkdir\w*|symlink\w*|rmtree|dump)\b|\bopen\s*\([^)]*,\s*['"][^'"]*[wax+>]/i;
const REDIRECT = /(?:^|[^<\d&])(?:\d|&)?>{1,2}\|?\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&<>()]+))/g;
const PROTECTED_SAMPLES = ['.eng/evidence/gates.jsonl', '.eng/evidence/verify-latest.json', '.eng/evidence/verify-x/summary.json', '.eng/state/session-x.json', '.eng/telemetry.jsonl'];
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;
const count = (s, ch) => s.split(ch).length - 1;

// ---------- evidence protection helpers (V3, A-02; review R-5, R-6, R-8) ----------
function normPath(p) {
  const abs = /^\//.test(p);
  const out = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return (abs ? '/' : '') + out.join('/');
}
const unconcat = (text) => text.replace(/(['"])\s*\+\s*\1/g, ''); // 'gat'+'es.jsonl' → 'gates.jsonl'
const globSeg = (g) => g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\[!/g, '[^');
// A word names protected OS state: directly, relative to a `cd` earlier in the command, or as a glob that matches it.
function isProtected(word, cwd = '') {
  const w = unconcat(String(word || '')).replace(/["']/g, '');
  if (!w) return false;
  const cands = [w];
  if (cwd && !/^([a-z]:)?[\\/~]/i.test(w)) cands.push(`${cwd}/${w}`);
  for (const c of cands.map(normPath)) {
    if (PROTECTED_STATE.test(c)) return true;
    if (/[*?[]/.test(c) && /\.eng|eviden|gate|verif|telem|state/i.test(c)) {
      const segs = c.split('/');
      for (const sample of PROTECTED_SAMPLES) {
        const k = sample.split('/').length;
        if (segs.length >= k && new RegExp(`^${segs.slice(-k).map(globSeg).join('/')}$`, 'i').test(sample)) return true;
      }
    }
  }
  return false;
}
const payloadWords = (text) => unconcat(text).split(/[\s'"`(),;=+{}[\]]+/).filter(Boolean);
// Simple assignments anywhere in the command (F=…; PowerShell $p = "…"+"…"), so `>> $F` is checked as its value.
function collectVars(cmd) {
  const vars = new Map();
  if (PS) for (const m of cmd.matchAll(/\$([A-Za-z_]\w*)\s*=\s*([^;\n]+)/g)) vars.set(m[1], unconcat(m[2].trim()).replace(/^["']|["']$/g, ''));
  else for (const m of cmd.matchAll(/(?:^|[\s;&|(])(?:export\s+|local\s+|declare\s+)?([A-Za-z_]\w*)=("([^"]*)"|'([^']*)'|[^\s;&|)]*)/g)) vars.set(m[1], m[3] ?? m[4] ?? m[2]);
  for (const [k, v] of vars) if (/\$\(|`/.test(v)) vars.delete(k); // command substitutions are analyzed where they occur
  return vars;
}
const expandVars = (text, vars) => (vars.size ? text.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, n) => (vars.has(n) ? vars.get(n) : m)) : text);
// "Read-only" tools that write when given these options or programs.
function writesAnyway(head, args, gitSub) {
  if (head === 'sort') return args.some((a) => /^-[a-z]*o/.test(a) || a.startsWith('--output'));
  if (head === 'uniq') return args.filter((a) => !a.startsWith('-')).length >= 2;
  if (head === 'sed') return args.some((a) => /(^|[;\s{}/])[wW]\s+\S/.test(a));
  if (head === 'find') return args.some((a) => /^-(fprint0?|fprintf|fls)$/.test(a));
  if (head === 'git' && gitSub === 'diff') return args.some((a) => a.startsWith('--output'));
  if (head === 'xxd') return args.some((a) => /^-r/.test(a));
  if (head === 'awk') return args.some((a) => /print[^;]*>|printf[^;]*>|system\s*\(|\|\s*getline/.test(a));
  return false;
}
// The operands a command writes: copy-like commands write only their destination (copying evidence out is a read).
const COPIERS = new Set(['cp', 'rsync', 'scp', 'install', 'copy-item', 'cpi', 'copy']);
function writtenOperands(head, args) {
  if (head === 'tar' && !args.some((a) => /^-?[a-z]*x/i.test(a) && !a.startsWith('--'))) {
    const fi = args.findIndex((a) => /^-?[a-z]*f$/i.test(a) && !a.startsWith('--'));
    return fi >= 0 ? [args[fi + 1]] : []; // create/list: only the archive file is written
  }
  if (head === 'zip') return args.filter((a) => !a.startsWith('-')).slice(0, 1);
  if (!COPIERS.has(head)) return args;
  const ti = args.findIndex((a) => a === '-t' || /^--target-directory/.test(a) || /^-destination$/i.test(a));
  const positional = args.filter((a, i) => !a.startsWith('-') && (ti < 0 || i !== ti + 1));
  if (ti >= 0) {
    const dest = args[ti].includes('=') ? args[ti].split('=')[1] : args[ti + 1];
    return [dest, ...positional.map((p) => `${dest}/${p.replace(/\\/g, '/').split('/').pop()}`)];
  }
  const dest = positional.slice(-1);
  // Copying into a directory writes <dir>/<name>: check those names when the destination is a directory we guard.
  if (positional.length >= 2 && /(^|\/)(\.eng(\/(evidence|state))?|docs\/engineering)\/?$/.test(normPath(dest[0]) + (dest[0].endsWith('/') ? '/' : '')))
    return [dest[0], ...positional.slice(0, -1).map((p) => `${dest[0].replace(/\/+$/, '')}/${p.replace(/\\/g, '/').split('/').pop()}`)];
  return dest;
}

// Executing the ledger or gate hook by hand (reading, copying, or editing its source is fine).
function runsHook(head, args) {
  if (PROTECTED_HOOKS.test(head)) return true;
  if (!HOOK_RUNNERS.has(head) || args.some((a) => a === '--check' || a === '-c')) return false;
  const script = (head === 'deno' && args[0] === 'run' ? args.slice(1) : args).find((a) => !a.startsWith('-'));
  return Boolean(script) && PROTECTED_HOOKS.test(script.replace(/["']/g, ''));
}

// ---------- lexing ----------
function heredocEnd(src, from, delim) {
  const m = src.slice(from).match(new RegExp(`^[\\t ]*${delim}[\\t ]*$`, 'm'));
  return m ? { bodyEnd: from + m.index, next: from + m.index + m[0].length } : { bodyEnd: src.length, next: src.length };
}

// Index of the ")" that closes a "$(" whose body starts at `start`.
function findClose(src, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (!PS && c === '\\') { i++; continue; }
    if (quote === '"') { if (c === '"') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '<' && src[i + 1] === '<') {
      const m = src.slice(i).match(HEREDOC);
      const nl = src.indexOf('\n', i);
      if (m && nl >= 0) { i = heredocEnd(src, nl + 1, m[2]).next - 1; continue; }
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return src.length;
}

// Command substitutions inside an expanding context (unquoted-delimiter heredoc body).
function collectSubs(text, subs) {
  for (let i = 0; i < text.length; i++) {
    if (!PS && text[i] === '\\') { i++; continue; }
    if (text[i] === '$' && text[i + 1] === '(') { const e = findClose(text, i + 2); subs.push(text.slice(i + 2, e)); i = e; }
    else if (!PS && text[i] === '`') { const e = text.indexOf('`', i + 1); const end = e < 0 ? text.length : e; subs.push(text.slice(i + 1, end)); i = end; }
  }
}

function lex(src, subs) {
  const segs = [];
  let cur = '';
  let quote = null;
  let op = null;
  let pending = [];
  const flush = (next) => {
    const text = cur.trim();
    if (text) segs.push({ text, heredoc: '', pipedIn: op === '|' });
    cur = '';
    op = next;
  };
  const takeSub = (i) => { const e = findClose(src, i + 2); subs.push(src.slice(i + 2, e)); cur += src.slice(i, e + 1); return e; };
  const takeTick = (i) => { const e = src.indexOf('`', i + 1); const end = e < 0 ? src.length : e; subs.push(src.slice(i + 1, end)); cur += src.slice(i, end + 1); return end; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote === "'") { cur += c; if (c === "'") quote = null; continue; }
    if (quote === '"') {
      if (!PS && c === '\\' && i + 1 < src.length) { cur += c + src[++i]; continue; }
      if (c === '$' && src[i + 1] === '(') { i = takeSub(i); continue; }
      if (!PS && c === '`') { i = takeTick(i); continue; }
      cur += c;
      if (c === '"') quote = null;
      continue;
    }
    if (!PS && c === '\\') { if (src[i + 1] === '\n') { i++; continue; } cur += c + (src[i + 1] ?? ''); i++; continue; }
    if (PS && c === '`') { if (src[i + 1] === '\n') { i++; continue; } cur += c + (src[i + 1] ?? ''); i++; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '#' && (cur === '' || /\s$/.test(cur))) { while (i + 1 < src.length && src[i + 1] !== '\n') i++; continue; }
    if (c === '$' && src[i + 1] === '(') { i = takeSub(i); continue; }
    if (!PS && c === '`') { i = takeTick(i); continue; }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = src.slice(i).match(HEREDOC);
      if (m) { pending.push({ delim: m[2], quoted: Boolean(m[1]) }); cur += m[0]; i += m[0].length - 1; continue; }
    }
    if (c === '\n') {
      flush(';');
      if (pending.length) {
        const seg = segs[segs.length - 1];
        let pos = i + 1;
        for (const h of pending) {
          const { bodyEnd, next } = heredocEnd(src, pos, h.delim);
          const body = src.slice(pos, bodyEnd);
          if (seg) seg.heredoc += body;
          if (!h.quoted) collectSubs(body, subs);
          pos = next;
        }
        i = pos - 1;
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

function trimParens(tok) {
  if (tok === '{}') return tok;
  let s = tok.replace(/^[({]+(?=.)/, '');
  while (/[)}]$/.test(s) && count(s, '(') + count(s, '{') < count(s, ')') + count(s, '}')) s = s.slice(0, -1);
  return s;
}

function stripPrefixes(t) {
  let i = 0;
  for (let guard = 0; guard < 20 && i < t.length; guard++) {
    const w = t[i];
    const skipOpts = (re) => { i++; while (i < t.length && t[i].startsWith('-')) i += re.test(t[i]) ? 2 : 1; };
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || SIMPLE_PREFIX.has(w)) i++;
    else if (w === 'sudo' || w === 'doas') skipOpts(/^-[ugCDhprtU]$|^--(user|group|host|prompt|chdir|role|type|other-user)$/);
    else if (w === 'env') { i++; while (i < t.length && (t[i].startsWith('-') || /^[A-Za-z_]\w*=/.test(t[i]))) i += /^-[uSC]$|^--(unset|chdir|split-string)$/.test(t[i]) ? 2 : 1; }
    else if (w === 'nice' || w === 'ionice') skipOpts(/^-[nct]$|^--adjustment$/);
    else if (w === 'timeout') { skipOpts(/^-[sk]$|^--(signal|kill-after)$/); i++; }
    else if (w === 'stdbuf') skipOpts(/^$/);
    else if (['npx', 'bunx', 'pnpx'].includes(w)) skipOpts(/^-p$|^--package$/);
    else break;
  }
  return t.slice(i);
}

// Whitespace split outside quotes; quotes and escapes resolved; $(...) kept intact.
function tokenize(text) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = null; else cur += c; continue; }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      if (!PS && c === '\\' && /[$`"\\]/.test(text[i + 1] ?? '')) { cur += text[++i]; continue; }
      if (c === '$' && text[i + 1] === '(') { const e = findClose(text, i + 2); cur += text.slice(i, e + 1); i = e; continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (!PS && c === '\\' && i + 1 < text.length) { cur += text[++i]; started = true; continue; }
    if (c === '$' && text[i + 1] === '(') { const e = findClose(text, i + 2); cur += text.slice(i, e + 1); i = e; started = true; continue; }
    if (/\s/.test(c)) { if (started) out.push(cur); cur = ''; started = false; continue; }
    cur += c;
    started = true;
  }
  if (started) out.push(cur);
  return out.map(trimParens).filter((x) => x !== '');
}

const headOf = (tok) => (tok || '').replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.exe$/, '');

// ---------- recursive deletes ----------
const SYSTEM_DIRS = new Set(['bin', 'boot', 'dev', 'etc', 'lib', 'lib32', 'lib64', 'opt', 'proc', 'sbin', 'srv', 'sys', 'usr', 'var',
  'system', 'applications', 'library', 'windows', 'program files', 'program files (x86)', 'programdata']);
const HOME = /^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%|\/root)$/i;

function classifyTarget(raw) {
  let t = raw.replace(/["']/g, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (/\$\(|`/.test(t)) return 'ask';
  if (/^\/+\*?$/.test(t)) return 'deny';
  t = t.replace(/^\/(?:mnt\/)?([a-z])(?=\/|$)/i, '$1:').replace(/(\/\*)+$/, '').replace(/\/+$/, '').replace(/^\.\/(?=.)/, '');
  const lower = t.toLowerCase();
  if (HOME.test(lower) || /^[a-z]:$/i.test(t)) return 'deny';
  const parts = lower.replace(/^[a-z]:/, '').split('/').filter(Boolean);
  if (t.startsWith('/') || /^[a-z]:\//i.test(t)) {
    if (['home', 'users'].includes(parts[0]) && parts.length <= 2) return 'deny';
    if (SYSTEM_DIRS.has(parts[0]) && (parts.length === 1 || ['windows', 'program files', 'program files (x86)'].includes(parts[0]))) return 'deny';
    if (parts.length <= 2) return 'ask';
  }
  if (HOME.test(parts[0] || '') && parts.length <= 2) return 'ask';
  if (['.', '..', '*', '.*', '.git', '$claude_project_dir', '${claude_project_dir}', '$pwd', '${pwd}', '$env:claude_project_dir'].includes(lower))
    return 'ask';
  return null;
}

function classifyTargets(targets, what) {
  for (const target of targets) {
    const verdict = classifyTarget(target);
    if (verdict === 'deny') denyReasons.add(`${what} of "${target}"`);
    else if (verdict === 'ask') askReasons.add(`${what} of "${target}" (repo root, .git, wildcard, computed path, home subfolder, or top-level dir)`);
  }
}

function checkDelete(head, args, fromStdin) {
  let recursive = false;
  let targets = [];
  if (head === 'rm') {
    recursive = args.some((a) => a === '--recursive' || (/^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a)));
    targets = args.filter((a) => !a.startsWith('-'));
  } else if (head === 'rimraf') {
    recursive = true;
    targets = args.filter((a) => !a.startsWith('-'));
  } else if (['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'].includes(head)) {
    recursive = args.some((a) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(a) || /^\/s$/i.test(a));
    targets = args.filter((a) => !a.startsWith('-') && !/^\/[a-z]$/i.test(a));
  }
  if (!recursive) return;
  if (fromStdin && targets.every((t) => t === '{}')) askReasons.add('recursive delete with targets read from stdin');
  classifyTargets(targets, 'recursive delete');
}

const FIND_NON_FILTERS = /^-(delete|exec|execdir|ok|okdir|depth|maxdepth|mindepth|xdev|mount|print|print0|L|P|H)$/;
function findHasFilter(args) {
  return args.some((a, i) => a.startsWith('-') && !FIND_NON_FILTERS.test(a) && !/^-(maxdepth|mindepth)$/.test(args[i - 1] || ''));
}
function checkFind(args) {
  const deletes = args.includes('-delete') ||
    args.some((a, i) => /^-(exec|execdir|ok|okdir)$/.test(a) && ['rm', 'rimraf'].includes(headOf(args[i + 1])) && args.slice(i + 2).some((x) => /^-[a-zA-Z]*[rR]/.test(x)));
  if (!deletes || findHasFilter(args)) return;
  const paths = [];
  for (const a of args) { if (a.startsWith('-') || a === '(' || a === '!') break; paths.push(a); }
  classifyTargets(paths.length ? paths : ['.'], 'unfiltered find delete');
}

// ---------- git ----------
const PROTECTED = /(?:^|[\s:/+])(main|master|prod|production|release[\w./-]*|trunk)(?:\s|$)/;
const abbrev = (a, full, min) => a.startsWith('--') && a.length >= min && full.startsWith(a.split('=')[0]);
function checkGit(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i]) ? 2 : 1;
  const sub = args[i] || '';
  const a = args.slice(i + 1);
  const has = (re) => a.some((x) => re.test(x));
  const shortHas = (letter) => a.some((x) => /^-[a-zA-Z]+$/.test(x) && x.includes(letter));
  const force = a.some((x) => abbrev(x, '--force', 4) && !x.startsWith('--force-')) || shortHas('f');
  const lease = a.some((x) => x.startsWith('--force-w') || x.startsWith('--force-i'));
  const dryRun = a.some((x) => abbrev(x, '--dry-run', 4)) || shortHas('n');
  if (sub === 'push') {
    if (force || has(/^--mirror$/) || has(/^\+\S+/)) askReasons.add('force push (rewrites remote history)');
    else if (lease && PROTECTED.test(` ${a.join(' ')} `)) askReasons.add('force push to a protected branch');
    if (a.some((x) => abbrev(x, '--delete', 5)) || shortHas('d') || has(/^:\S+/)) askReasons.add('deleting a remote branch or tag');
  }
  if (sub === 'reset' && a.some((x) => abbrev(x, '--hard', 4))) askReasons.add('git reset --hard discards uncommitted work (prefer `git stash -u`)');
  if (sub === 'clean' && force && !dryRun) askReasons.add('git clean --force deletes untracked (and possibly ignored) files');
  const wholeTree = has(/^(\.|\.\/|:\/|\*|:\/\.)$/);
  if (sub === 'checkout' && wholeTree) askReasons.add('git checkout of the whole tree discards uncommitted work');
  if (sub === 'restore' && wholeTree && (!has(/^(--staged|-S)$/) || has(/^(--worktree|-W)$/))) askReasons.add('git restore of the whole tree discards uncommitted work');
  if ((sub === 'checkout' || sub === 'switch') && (force || has(/^--discard-changes$/))) askReasons.add(`git ${sub} --force discards uncommitted work`);
  if (sub === 'branch' && (shortHas('D') || ((has(/^--delete$/) || shortHas('d')) && force))) askReasons.add('force-deleting a branch (use -d)');
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
  if (depth > 5 || !src || !src.trim()) return;
  const subs = [];
  const segs = lex(src, subs);
  for (const s of subs) analyze(s, depth + 1);
  let cwd = ''; // directory set by an earlier `cd` in this command (relative to the project)
  segs.forEach((seg, idx) => {
    const raw = tokenize(seg.text);
    if (raw.length === 1 && /^(printenv|env|export|set)$/.test(raw[0])) askReasons.add('dumping the whole environment (may contain secrets)');
    const t = stripPrefixes(raw);
    if (!t.length) return;
    const head = headOf(t[0]);
    const args = t.slice(1);
    const prev = segs[idx - 1];
    const prevTokens = prev ? stripPrefixes(tokenize(prev.text)) : [];
    const prevHead = headOf(prevTokens[0]);
    const prevPayload = prev && seg.pipedIn ? `${prevTokens.slice(1).join(' ')}\n${prev.heredoc}` : '';

    // Payloads executed by shells and evaluators.
    if (SHELLS.has(head)) {
      const ci = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      if (ci >= 0) analyze(args[ci + 1] === '--' ? args[ci + 2] : args[ci + 1], depth + 1);
      else {
        analyze(seg.heredoc, depth + 1);
        if (seg.pipedIn) {
          if (['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'].includes(prevHead))
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
    if (head === 'cmd' && /^\/[ck]$/i.test(args[0] || '')) analyze(args.slice(1).join(' '), depth + 1);
    if (head === 'eval' || head === 'invoke-expression' || head === 'iex') analyze(args.join(' '), depth + 1);
    if (head === 'xargs') {
      let j = 0;
      while (j < args.length && args[j].startsWith('-')) j += ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a'].includes(args[j]) ? 2 : 1;
      const inner = stripPrefixes(args.slice(j));
      const filteredFind = prevHead === 'find' && findHasFilter(prevTokens.slice(1));
      if (inner.length && !filteredFind) checkDelete(headOf(inner[0]), inner.slice(1), true);
    }

    checkDelete(head, args, false);
    if (head === 'find') checkFind(args);
    const gitSub = head === 'git' ? checkGit(args) : '';

    const prose = ['echo', 'printf', 'write-output', 'write-host'].includes(head) ||
      (head === 'git' && ['commit', 'tag', 'notes'].includes(gitSub)) || (head === 'gh' && ['pr', 'issue'].includes(args[0]));
    const readOnly = READ_ONLY.has(head) ||
      (head === 'git' && GIT_READ_ONLY.has(gitSub)) ||
      (head === 'find' && !args.some((a) => /^-(delete|exec|execdir|ok|okdir)$/.test(a))) ||
      (head === 'sed' && !args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) ||
      (head === 'kubectl' && ['get', 'describe', 'logs', 'explain', 'top', 'version', 'api-resources'].includes(args[0]));

    // Secrets: commands that could print or ship a secrets file.
    let secretText = (prose ? seg.text.replace(QUOTED, ' ') : seg.text).replace(/--env-file(=|\s+)\S+/g, ' ');
    if (GREP_FAMILY.has(head)) {
      const explicit = args.some((a) => /^(-e|-f|--regexp|--file)(=|$)/.test(a));
      const operands = args.filter((a) => !a.startsWith('-'));
      secretText = (explicit ? operands : operands.slice(1)).join(' ');
    }
    if (['select-string', 'sls'].includes(head)) secretText = seg.text.replace(/-pattern\s+("[^"]*"|'[^']*'|\S+)/gi, ' ');
    const secret = mentionsSecretPath(secretText);
    const gitSafe = head === 'git' && ['status', 'check-ignore', 'ls-files', 'rm', 'add'].includes(gitSub);
    if (secret && !SECRET_SAFE.has(head) && !gitSafe) askReasons.add(`command touches the secrets file "${secret}" (contents could reach the transcript)`);
    if (INTERPRETERS.has(head) && !SHELLS.has(head)) {
      const fed = mentionsSecretPath(`${seg.heredoc}\n${prevPayload}`);
      if (fed) askReasons.add(`script touches the secrets file "${fed}" (contents could reach the transcript)`);
    }
    if (/^(get-childitem|gci|dir|ls)$/.test(head) && args.some((a) => /^env:\\?$/i.test(a))) askReasons.add('dumping the whole environment (may contain secrets)');

    // Evidence integrity (V3, A-02): verification evidence, the gate ledger, session state, and telemetry
    // are written only by eng-verify and the hooks. Reading them is fine; redirecting into them, writing them
    // with a file command, writing them from interpreter code, or running the ledger/gate hooks by hand is not.
    const redirects = [...seg.text.matchAll(REDIRECT)].map((m) => m[1] || m[2] || m[3]);
    const writer = !(readOnly && !writesAnyway(head, args, gitSub)) && !prose && !NAV.has(head);
    const interp = INTERPRETERS.has(head) && !SHELLS.has(head) && !POWERSHELLS.has(head);
    const operands = writtenOperands(head, args).filter(Boolean).flatMap((a) => (a.includes('=') ? [a, a.slice(a.indexOf('=') + 1)] : [a]));
    const program = interp ? `${args.join(' ')}\n${seg.heredoc}\n${prevPayload}` : '';
    const prot = (x) => isProtected(x, cwd);
    if (redirects.some(prot) || (writer && !interp && operands.some(prot)) ||
      (program && payloadWords(program).some(prot) && WRITE_HINT.test(unconcat(program))) || runsHook(head, args))
      denyReasons.add(EVIDENCE_REASON);
    const profile = (x) => { const w = String(x).replace(/["']/g, ''); return PROFILE.test(normPath(w)) || (cwd && !/^([a-z]:)?[\\/~]/i.test(w) && PROFILE.test(normPath(`${cwd}/${w}`))); };
    if (redirects.some(profile) || (writer && !interp && operands.some(profile)) ||
      (program && payloadWords(program).some(profile) && WRITE_HINT.test(program)))
      askReasons.add(PROFILE_REASON);
    if (NAV.has(head)) {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target || target === '-' || head === 'popd') cwd = '';
      else cwd = normPath(/^([a-z]:)?[\\/~]/i.test(target) ? target : cwd ? `${cwd}/${target}` : target);
    }

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
  const joined = activeSegments.map((s) => s.replace(QUOTED, ' ')).join(' ; ');
  if (/\b(prod|production)\b/i.test(joined) && /\b(deploy|migrate|apply|rollout|scale|delete|destroy|drop|truncate|restart|seed)\b/i.test(joined))
    askReasons.add('mutating command that references production');
}

try {
  const cmd = String(input?.tool_input?.command ?? '');
  if (!cmd.trim()) process.exit(0);
  if (cmd.length > 100000) askReasons.add('command too long to analyze');
  else {
    if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd)) denyReasons.add('fork bomb');
    analyze(expandVars(cmd, collectVars(cmd)));
    checkActive();
    const leaked = findSecret(cmd);
    if (leaked) askReasons.add(`command contains what looks like a real ${leaked} (reference an environment variable instead)`);
  }
} catch (e) {
  askReasons.add(`guard-bash could not analyze this command (${e?.message || e}); human review required`);
}

// Telemetry: decision + reason categories only (quoted parts removed); never the command text.
const logGuard = (decision, reasons) =>
  logEvent(projectDir(), { event: 'guard', hook: 'guard-bash', decision, reasons: [...reasons].map((r) => r.replace(/"[^"]*"|`[^`]*`/g, '…').slice(0, 120)) });
if (denyReasons.size) {
  logGuard('deny', denyReasons);
  decide('deny', `guard-bash: ${[...denyReasons].join('; ')}. Never allowed from an agent; if truly needed, the human must run it manually.`);
}
if (askReasons.size) {
  logGuard('ask', askReasons);
  decide('ask', `guard-bash: ${[...askReasons].join('; ')}. Needs explicit human approval (constitution → Human gates). Don't work around it; prefer a safer alternative or ask the user.`);
}
process.exit(0);
