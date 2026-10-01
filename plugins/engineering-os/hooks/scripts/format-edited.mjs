#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit): run the project's own formatter on the edited file when one is configured.
// Never blocks. Does nothing if the project has no formatter set up.
import { existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readInput, projectDir } from './lib.mjs';

const file = readInput()?.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

const root = projectDir();
const ext = extname(file).toLowerCase();
const win = process.platform === 'win32';
const q = (s) => (win ? `"${s}"` : s); // shell is required for .cmd shims on Windows
const run = (bin, args) => spawnSync(q(bin), args.map(q), { cwd: root, stdio: 'ignore', timeout: 20000, shell: win });
const onPath = (bin) => spawnSync(win ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;
const localBin = (name) => {
  const p = join(root, 'node_modules', '.bin', win ? `${name}.cmd` : name);
  return existsSync(p) ? p : null;
};
const anyExists = (names) => names.some((n) => existsSync(join(root, n)));
const readText = (name) => {
  try {
    return readFileSync(join(root, name), 'utf8');
  } catch {
    return '';
  }
};

const WEB = /^\.(m|c)?[jt]sx?$|^\.(json|jsonc|css|scss|less|html|vue|svelte|astro|md|mdx|ya?ml|graphql)$/;

if (WEB.test(ext)) {
  const biome = localBin('biome');
  const prettier = localBin('prettier');
  if (biome && anyExists(['biome.json', 'biome.jsonc'])) run(biome, ['format', '--write', file]);
  else if (
    prettier &&
    (/"prettier"\s*:/.test(readText('package.json')) ||
      anyExists(['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.js', '.prettierrc.cjs',
        '.prettierrc.mjs', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts']))
  )
    run(prettier, ['--write', file]);
} else if (ext === '.py') {
  const pyproject = readText('pyproject.toml');
  if ((/\[tool\.ruff/.test(pyproject) || anyExists(['ruff.toml', '.ruff.toml'])) && onPath('ruff')) run('ruff', ['format', file]);
  else if (/\[tool\.black\]/.test(pyproject) && onPath('black')) run('black', ['-q', file]);
} else if (ext === '.go' && onPath('gofmt')) run('gofmt', ['-w', file]);
else if (ext === '.rs' && onPath('rustfmt')) run('rustfmt', [file]);

process.exit(0);
