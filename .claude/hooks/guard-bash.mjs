#!/usr/bin/env node
// PreToolUse(Bash|PowerShell): stop destructive, irreversible, or secret-exposing commands.
// Gated actions proceed only after explicit human approval, signalled by including the marker
// ENG_HUMAN_APPROVED=1 in the command. Catastrophic actions are never allowed.
import { readInput, block, isSecretPath, findSecret } from './lib.mjs';

const cmd = String(readInput()?.tool_input?.command ?? '');
if (!cmd.trim()) process.exit(0);

const approved = /\bENG_HUMAN_APPROVED=1\b/.test(cmd);
const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;
const noHeredoc = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, ' ');

// Commit/PR text routinely mentions "drop table" or "production": regex-scan it without quoted prose.
const isProse = /^\s*(?:[A-Za-z_]+=\S+\s+)*(?:git\s+(?:commit|tag)|gh\s+(?:pr|issue)|echo|printf)\b/.test(cmd);
const scan = isProse ? collapse(noHeredoc.replace(QUOTED, ' ')) : collapse(cmd);

// Token view: quoted strings keep their content but cannot split tokens or segments.
const norm = noHeredoc.replace(QUOTED, (q) => q.slice(1, -1).replace(/[\s;&|<>]+/g, '_'));
const segments = norm.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
const PREFIX = new Set(['sudo', 'command', 'exec', 'env', 'time', 'nohup']);
const tokens = (seg) => {
  const t = seg.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || PREFIX.has(t[i]))) i++;
  return t.slice(i);
};

const catastrophic = [];
const gated = [];

// Recursive deletes (rm, PowerShell Remove-Item, cmd rd/del).
const SYSTEM_DIRS = 'bin|boot|dev|etc|home|lib|lib32|lib64|opt|proc|root|sbin|srv|sys|usr|var|Users|System|Applications|Library|Windows';
const CATASTROPHIC_TARGET = new RegExp(
  `^(?:/|/\\*|~|~/|~/\\*|\\$HOME/?\\*?|\\$\\{HOME\\}/?|\\$env:USERPROFILE[\\\\/]?|[A-Za-z]:[\\\\/]?\\*?|/(?:${SYSTEM_DIRS})/?\\*?)$`,
);
const GATED_TARGET = /^(?:\.|\.\/|\.\/\*|\*|\.\.|\.\.\/|\.git\/?|\.\/\.git\/?|\$CLAUDE_PROJECT_DIR\/?|\/[A-Za-z0-9._-]+\/?)$/;
for (const seg of segments) {
  const t = tokens(seg);
  const head = (t[0] || '').toLowerCase();
  const args = t.slice(1);
  let recursive = false;
  let targets = [];
  if (head === 'rm') {
    recursive = args.some((a) => a === '--recursive' || (/^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a)));
    targets = args.filter((a) => !a.startsWith('-'));
  } else if (['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'].includes(head)) {
    recursive = args.some((a) => /^-r(ecurse)?$/i.test(a) || /^\/s$/i.test(a));
    targets = args.filter((a) => !a.startsWith('-') && !/^\/[a-z]$/i.test(a));
  }
  if (!recursive) continue;
  for (const target of targets) {
    if (CATASTROPHIC_TARGET.test(target)) catastrophic.push(`recursive delete of "${target}"`);
    else if (GATED_TARGET.test(target)) gated.push(`recursive delete of "${target}" (repo root, .git, wildcard, or top-level dir)`);
  }
}

if (/\bmkfs(\.\w+)?\b/.test(scan) || /\bdd\b[^|;&]*\bof=\/dev\/(?!null\b)/.test(scan) || />\s*\/dev\/(sd|nvme|disk|hd)/.test(scan))
  catastrophic.push('raw disk write/format');
if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd)) catastrophic.push('fork bomb');
if (/\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?(777|a\+rwx)\s+\/(\s|$)/.test(scan)) catastrophic.push('chmod 777 on /');

// Git: history rewriting, discarding work, skipping hooks, staging secrets.
const PROTECTED = /(?:^|[\s:/+])(main|master|prod|production|release[\w./-]*|trunk)(?:\s|$)/;
for (const seg of segments) {
  const t = tokens(seg);
  if (t[0] !== 'git') continue;
  let i = 1;
  while (i < t.length && t[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree'].includes(t[i]) ? 2 : 1;
  const sub = t[i] || '';
  const args = t.slice(i + 1);
  const has = (re) => args.some((a) => re.test(a));
  if (sub === 'push') {
    if (has(/^(--force|-f|--mirror)$/) || has(/^\+\S+/)) gated.push('force push (rewrites remote history)');
    else if (has(/^--force-with-lease/) && PROTECTED.test(` ${args.join(' ')} `)) gated.push('force push to a protected branch');
    if (has(/^(--delete|-d)$/) || has(/^:\S+/)) gated.push('deleting a remote branch/tag');
  }
  if (sub === 'reset' && has(/^--hard$/)) gated.push('git reset --hard discards uncommitted work (prefer `git stash -u`)');
  if (sub === 'clean' && has(/^-[a-zA-Z]*f/)) gated.push('git clean -f deletes untracked files');
  if ((sub === 'checkout' || sub === 'restore') && !has(/^--staged$/) && has(/^(\.|\.\/|:\/|\*)$/))
    gated.push(`git ${sub} of the whole tree discards uncommitted work`);
  if (sub === 'checkout' && has(/^(-f|--force)$/)) gated.push('git checkout --force discards uncommitted work');
  if (sub === 'branch' && (has(/^-D$/) || (has(/^--delete$/) && has(/^(--force|-f)$/)))) gated.push('git branch -D deletes an unmerged branch (use -d)');
  if (sub === 'stash' && ['clear', 'drop'].includes(args[0])) gated.push(`git stash ${args[0]} destroys stashed work`);
  if (['filter-branch', 'filter-repo'].includes(sub)) gated.push('history rewrite');
  if (['commit', 'push', 'merge', 'rebase'].includes(sub) && has(/^--no-verify$/)) gated.push('--no-verify skips hooks');
  if (sub === 'commit' && has(/^-[a-zA-Z]*n[a-zA-Z]*$/)) gated.push('git commit -n skips hooks');
  if (sub === 'add' && args.some((a) => isSecretPath(a))) gated.push('staging a secrets file');
}

// Data, infrastructure, releases, supply chain.
if (/\b(drop\s+(database|schema|table)|truncate\s+(table\s+)?\w)/i.test(scan)) gated.push('destructive SQL (DROP/TRUNCATE)');
if (/\b(terraform|tofu)\s+(\S+\s+)*?(apply|destroy)\b/.test(scan) || /\bpulumi\s+(up|destroy)\b/.test(scan))
  gated.push('infrastructure apply/destroy');
if (/\bkubectl\s+(\S+\s+)*?(delete|drain)\b/.test(scan) || /\bhelm\s+(uninstall|delete)\b/.test(scan)) gated.push('cluster resource deletion');
if (/\b(aws|gcloud|az|doctl)\b[^|;&]*\s(rm|rb|delete[\w-]*|terminate[\w-]*|remove[\w-]*|purge[\w-]*)(\s|$)/.test(scan))
  gated.push('cloud resource deletion');
if (/\b(vercel|netlify)\b[^|;&]*--prod\b/.test(scan) || /\b(fly|flyctl)\s+deploy\b/.test(scan)) gated.push('production deploy');
if (/\b(npm|pnpm|yarn|bun)\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b|\bdocker\s+push\b/.test(scan))
  gated.push('external publish/release');
if (/\b(prod|production)\b/i.test(scan) && /\b(deploy|migrate|apply|rollout|scale|delete|destroy|drop|truncate|restart|seed)\b/i.test(scan))
  gated.push('mutating command that references production');
if (/\b(curl|wget|iwr|invoke-webrequest)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i.test(scan) || /\biex\b[^|;&]*\b(iwr|invoke-webrequest|downloadstring)/i.test(scan))
  gated.push('piping a remote script into a shell (supply-chain risk)');

// Secrets: commands that print secret files or the whole environment into the transcript.
const READERS = /^(cat|less|more|head|tail|bat|grep|egrep|rg|ag|awk|sed|strings|xxd|od|hexdump|base64|nl|type|get-content|gc|select-string|sls|jq|yq)$/i;
for (const seg of segments) {
  const t = tokens(seg);
  if (t.length && READERS.test(t[0]) && t.slice(1).some((a) => !a.startsWith('-') && isSecretPath(a)))
    gated.push('reading a secrets file into the transcript');
}
if (segments.some((s) => /^(printenv|env|export|set|get-childitem env:|gci env:|dir env:)$/i.test(s.trim())))
  gated.push('dumping the whole environment (may contain secrets)');
const leaked = findSecret(cmd);
if (leaked) gated.push(`command contains what looks like a real ${leaked} (reference an environment variable instead)`);

const tag = 'BLOCKED by .claude/hooks/guard-bash.mjs';
if (catastrophic.length)
  block(`${tag}: ${[...new Set(catastrophic)].join('; ')}. Never allowed from an agent; if truly needed, the human must run it manually.`);
if (gated.length && !approved)
  block(
    `${tag}: ${[...new Set(gated)].join('; ')}.\n` +
      'Needs explicit human approval (CLAUDE.md → Human decision gates). Prefer a safer alternative; otherwise ask the user. ' +
      'Only if the user approved this exact action in this conversation, re-run it with the marker ENG_HUMAN_APPROVED=1 in the command (e.g. as a bash env prefix).',
  );
process.exit(0);
