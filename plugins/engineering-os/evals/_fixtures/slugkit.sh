#!/usr/bin/env bash
# Shared fixture: a tiny Node library with tests, git history, an engineering profile, and a README typo.
# Usage (from a case's scaffold.sh): source "$(dirname "$0")/../_fixtures/slugkit.sh"; make_slugkit "$WS"
set -euo pipefail

make_slugkit() {
  local ws="$1"
  mkdir -p "$ws/src" "$ws/test" "$ws/docs/engineering"
  cd "$ws"
  cat > package.json <<'JSON'
{ "name": "slugkit", "version": "1.0.0", "type": "module",
  "scripts": { "test": "node --test", "lint": "node scripts/lint.mjs" } }
JSON
  mkdir -p scripts
  cat > scripts/lint.mjs <<'JS'
import { readFileSync, readdirSync } from 'node:fs';
let bad = 0;
for (const dir of ['src', 'test']) for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const t = readFileSync(`${dir}/${f}`, 'utf8');
  if (/\bvar\s/.test(t) || /console\.log/.test(t)) { console.error(`lint: ${dir}/${f} uses var or console.log`); bad++; }
}
process.exit(bad ? 1 : 0);
JS
  cat > src/slugify.js <<'JS'
export function slugify(input) {
  if (typeof input !== 'string') throw new TypeError('slugify expects a string');
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
JS
  cat > test/slugify.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

test('lowercases and hyphenates', () => assert.equal(slugify('Hello World'), 'hello-world'));
test('strips accents', () => assert.equal(slugify('Café Déjà Vu'), 'cafe-deja-vu'));
test('trims separators', () => assert.equal(slugify('  --Hi!--  '), 'hi'));
test('rejects non-strings', () => assert.throws(() => slugify(42), TypeError));
JS
  cat > README.md <<'MD'
# slugkit

Turn titles into URL slugs. You will recieve a lowercase, hyphenated string.

    import { slugify } from './src/slugify.js';
    slugify('Hello World'); // 'hello-world'
MD
  printf '.eng/\n.bash*\n.profile\n.claude/\n.config/\n.cache/\n.npm/\n.local/\nnode_modules/\n.env\n' > .gitignore
  cat > docs/engineering/status.md <<'MD'
# Engineering Status

## Now
- Objective: none (idle)
- Phase: idle
MD
  git init -q -b main
  git config user.email bench@example.com
  git config user.name bench
  git add -A
  git commit -qm "baseline: slugkit"
  node "${ENG_OS_ROOT:?}/scripts/eng-detect.mjs" "$ws" --write >/dev/null
  git add -A && git commit -qm "chore: engineering profile"
}
