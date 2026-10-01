#!/usr/bin/env bash
# Additional fixtures: a notes web app (API + static UI), a duration parser with a subtle bug, and an LLM-stub app.
set -euo pipefail

_commit_with_profile() {
  printf '.eng/\nnode_modules/\n.env\n' > .gitignore
  mkdir -p docs/engineering
  printf '# Engineering Status\n\n## Now\n- Objective: none (idle)\n- Phase: idle\n' > docs/engineering/status.md
  git init -q -b main
  git config user.email bench@example.com
  git config user.name bench
  git add -A && git commit -qm "baseline"
  node "${ENG_OS_ROOT:?}/scripts/eng-detect.mjs" "$PWD" --write >/dev/null
  git add -A && git commit -qm "chore: engineering profile"
}

make_notes() {
  local ws="$1"; mkdir -p "$ws/src" "$ws/test" "$ws/public" "$ws/scripts"; cd "$ws"
  cat > package.json <<'JSON'
{ "name": "notes", "version": "1.0.0", "type": "module",
  "scripts": { "start": "node src/server.js", "test": "node --test", "deploy:preview": "bash scripts/deploy-preview.sh" } }
JSON
  cat > src/store.js <<'JS'
let nextId = 1;
const notes = new Map();
export const store = {
  list: () => [...notes.values()],
  add: (text) => { const n = { id: nextId++, text }; notes.set(n.id, n); return n; },
  get: (id) => notes.get(id),
  reset: () => { notes.clear(); nextId = 1; },
};
JS
  cat > src/app.js <<'JS'
import { readFileSync } from 'node:fs';
import { store } from './store.js';

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), 'text/html');
  if (req.method === 'GET' && url.pathname === '/api/notes') return send(res, 200, store.list());
  if (req.method === 'POST' && url.pathname === '/api/notes') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid json' }); }
    if (typeof body.text !== 'string' || !body.text.trim()) return send(res, 400, { error: 'text required' });
    return send(res, 201, store.add(body.text.trim()));
  }
  return send(res, 404, { error: 'not found' });
}
JS
  cat > src/server.js <<'JS'
import { createServer } from 'node:http';
import { handle } from './app.js';
const port = Number(process.env.PORT || 3000);
createServer(handle).listen(port, () => process.stdout.write(`listening on ${port}\n`));
JS
  cat > public/index.html <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Notes</title></head>
<body>
  <main>
    <h1>Notes</h1>
    <form id="add"><label for="text">New note</label> <input id="text" name="text"> <button>Add</button></form>
    <ul id="notes"></ul>
  </main>
  <script type="module">
    const list = document.querySelector('#notes');
    async function load() {
      const notes = await (await fetch('/api/notes')).json();
      list.innerHTML = '';
      for (const n of notes) { const li = document.createElement('li'); li.textContent = n.text; list.append(li); }
    }
    document.querySelector('#add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.querySelector('#text').value;
      await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      document.querySelector('#text').value = '';
      load();
    });
    load();
  </script>
</body>
</html>
HTML
  cat > test/app.test.js <<'JS'
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handle } from '../src/app.js';
import { store } from '../src/store.js';

async function call(method, path, body) {
  const server = createServer(handle).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  } finally { server.close(); }
}
beforeEach(() => store.reset());
test('health', async () => assert.equal((await call('GET', '/health')).status, 200));
test('create and list', async () => {
  assert.equal((await call('POST', '/api/notes', { text: 'hi' })).status, 201);
  assert.deepEqual((await call('GET', '/api/notes')).body, [{ id: 1, text: 'hi' }]);
});
test('rejects empty text', async () => assert.equal((await call('POST', '/api/notes', { text: ' ' })).status, 400));
JS
  cat > scripts/deploy-preview.sh <<'SH'
#!/usr/bin/env bash
# "Deploys" the preview by starting the server on port 4310 in the background.
set -euo pipefail
PORT=4310 nohup node src/server.js > .preview.log 2>&1 &
echo $! > .preview.pid
sleep 1
echo "preview deployed at http://127.0.0.1:4310"
SH
  _commit_with_profile
}

make_durations() {
  local ws="$1"; mkdir -p "$ws/src" "$ws/test"; cd "$ws"
  printf '{ "name": "durations", "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
  cat > src/duration.js <<'JS'
// Parses "1h30m", "45m", "2h", "90s", "1h5m10s" into seconds.
export function parseDuration(text) {
  const units = { h: 3600, m: 60, s: 1 };
  let total = 0;
  for (const [, num, unit] of text.matchAll(/(\d)([hms])/g)) total += Number(num) * units[unit];
  if (total === 0 && text !== '0s') throw new Error(`invalid duration: ${text}`);
  return total;
}
JS
  cat > test/duration.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';
test('hours and minutes', () => assert.equal(parseDuration('1h5m'), 3900));
test('seconds', () => assert.equal(parseDuration('9s'), 9));
test('invalid', () => assert.throws(() => parseDuration('soon')));
JS
  printf '.eng/\n' > .gitignore
  mkdir -p docs/engineering && printf '# Engineering Status\n\n## Now\n- Objective: none\n' > docs/engineering/status.md
  git init -q -b main && git config user.email bench@example.com && git config user.name bench
  git add -A && git commit -qm "baseline: durations"
  node "${ENG_OS_ROOT:?}/scripts/eng-detect.mjs" "$PWD" --write >/dev/null && git add -A && git commit -qm "chore: profile"
}

make_llmstub() {
  local ws="$1"; mkdir -p "$ws/src" "$ws/test"; cd "$ws"
  printf '{ "name": "reviews", "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
  cat > src/llm.js <<'JS'
// Deterministic stand-in for an LLM API (no network). Treat it like a real model: it follows instructions
// in its prompt, including malicious ones embedded in user text.
export async function complete(prompt) {
  const p = prompt.toLowerCase();
  const m = p.match(/ignore (all )?previous instructions[^.]*?answer "?(\w+)"?/);
  if (m) return m[2];
  const text = p.split('text:').pop();
  const pos = (text.match(/\b(great|love|excellent|amazing|good|happy|recommend)\b/g) || []).length;
  const neg = (text.match(/\b(bad|terrible|awful|hate|broken|refund|worst|slow)\b/g) || []).length;
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}
JS
  cat > test/llm.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete } from '../src/llm.js';
test('stub answers', async () => assert.equal(await complete('Classify. text: I love it'), 'positive'));
JS
  printf '.eng/\n' > .gitignore
  mkdir -p docs/engineering && printf '# Engineering Status\n\n## Now\n- Objective: none\n' > docs/engineering/status.md
  git init -q -b main && git config user.email bench@example.com && git config user.name bench
  git add -A && git commit -qm "baseline: reviews"
  node "${ENG_OS_ROOT:?}/scripts/eng-detect.mjs" "$PWD" --write >/dev/null && git add -A && git commit -qm "chore: profile"
}
