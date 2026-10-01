#!/usr/bin/env node
// Project adapter: detect stack, package manager, verification commands, CI, deploy, data, and layout.
// Usage: node eng-detect.mjs [projectDir] [--write]   (--write saves docs/engineering/project-profile.json)
// Deterministic and offline. Commands come only from the project's own manifests/config.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;

function detectNode(root, rel, out) {
  const pkg = readJson(join(root, rel, 'package.json'));
  if (!pkg) return;
  out.languages.add(existsSync(join(root, rel, 'tsconfig.json')) ? 'typescript' : 'javascript');
  const lock = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm']]
    .find(([f]) => existsSync(join(root, rel, f)) || existsSync(join(root, f)));
  const pm = lock ? lock[1] : 'npm';
  if (!rel) out.packageManager = pm;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (d) => Object.hasOwn(deps, d);
  for (const [dep, name] of [['next', 'nextjs'], ['react', 'react'], ['vue', 'vue'], ['svelte', 'svelte'], ['@angular/core', 'angular'], ['vite', 'vite'],
    ['express', 'express'], ['fastify', 'fastify'], ['@nestjs/core', 'nestjs'], ['hono', 'hono'], ['react-native', 'react-native'], ['expo', 'expo'],
    ['electron', 'electron'], ['tailwindcss', 'tailwind']]) if (has(dep)) out.frameworks.add(name);
  for (const [dep, name] of [['prisma', 'prisma'], ['@prisma/client', 'prisma'], ['drizzle-orm', 'drizzle'], ['mongoose', 'mongodb'], ['pg', 'postgres'],
    ['mysql2', 'mysql'], ['sequelize', 'sequelize'], ['typeorm', 'typeorm'], ['redis', 'redis'], ['ioredis', 'redis']]) if (has(dep)) out.database.add(name);
  for (const [dep, name] of [['vitest', 'vitest'], ['jest', 'jest'], ['mocha', 'mocha'], ['@playwright/test', 'playwright'], ['cypress', 'cypress'],
    ['@testing-library/react', 'testing-library']]) if (has(dep)) out.testFrameworks.add(name);
  for (const [dep, name] of [['openai', 'openai-sdk'], ['@anthropic-ai/sdk', 'anthropic-sdk'], ['ai', 'vercel-ai-sdk'], ['langchain', 'langchain']]) if (has(dep)) out.ai.add(name);

  const scripts = pkg.scripts || {};
  const run = (s) => (pm === 'npm' ? `npm run ${s}` : pm === 'yarn' ? `yarn ${s}` : `${pm} run ${s}`);
  const cwd = rel || '.';
  const add = (kind, cmd, source, extra = {}) => out.checks.push({ id: `${kind}${rel ? `:${rel}` : ''}`, kind, cmd, cwd, source, ...extra });
  const pick = (names) => names.find((n) => scripts[n]);
  const lint = pick(['lint', 'lint:check', 'eslint']);
  if (lint) add('lint', run(lint), `package.json scripts.${lint}`);
  const fmt = pick(['format:check', 'fmt:check', 'prettier:check']);
  if (fmt) add('format', run(fmt), `package.json scripts.${fmt}`);
  const tc = pick(['typecheck', 'type-check', 'tsc', 'check-types', 'types']);
  if (tc) add('typecheck', run(tc), `package.json scripts.${tc}`);
  else if (existsSync(join(root, rel, 'tsconfig.json')) && has('typescript')) add('typecheck', 'npx tsc --noEmit', 'tsconfig.json + typescript');
  const test = pick(['test:unit', 'test']);
  if (test && !/no test specified/.test(scripts[test])) add('test', run(test), `package.json scripts.${test}`);
  const e2e = pick(['test:e2e', 'e2e', 'test:integration']);
  if (e2e) add(e2e === 'test:integration' ? 'integration' : 'e2e', run(e2e), `package.json scripts.${e2e}`, { slow: true });
  const build = pick(['build']);
  if (build) add('build', run(build), 'package.json scripts.build');
  const auditCmd = { npm: 'npm audit --audit-level=high', pnpm: 'pnpm audit --audit-level high', yarn: 'yarn npm audit --severity high', bun: null }[pm];
  if (auditCmd && (lock || existsSync(join(root, rel, 'package-lock.json')))) add('security', auditCmd, `${pm} lockfile`, { network: true });
}

function detectPython(root, out) {
  const pyproject = readText(join(root, 'pyproject.toml'));
  const req = readText(join(root, 'requirements.txt')) + readText(join(root, 'requirements-dev.txt'));
  if (!pyproject && !req && !existsSync(join(root, 'setup.py'))) return;
  out.languages.add('python');
  out.packageManager ||= existsSync(join(root, 'uv.lock')) ? 'uv' : existsSync(join(root, 'poetry.lock')) ? 'poetry' : 'pip';
  const all = `${pyproject}\n${req}`.toLowerCase();
  for (const [dep, name] of [['django', 'django'], ['flask', 'flask'], ['fastapi', 'fastapi']]) if (all.includes(dep)) out.frameworks.add(name);
  for (const [dep, name] of [['sqlalchemy', 'sqlalchemy'], ['psycopg', 'postgres'], ['pymongo', 'mongodb'], ['alembic', 'alembic']]) if (all.includes(dep)) out.database.add(name);
  for (const [dep, name] of [['openai', 'openai-sdk'], ['anthropic', 'anthropic-sdk'], ['langchain', 'langchain']]) if (all.includes(dep)) out.ai.add(name);
  const prefix = out.packageManager === 'uv' ? 'uv run ' : out.packageManager === 'poetry' ? 'poetry run ' : 'python -m ';
  const add = (kind, cmd, source, extra = {}) => out.checks.push({ id: kind, kind, cmd, cwd: '.', source, ...extra });
  if (/\[tool\.ruff/.test(pyproject) || existsSync(join(root, 'ruff.toml')) || all.includes('ruff')) {
    add('lint', `${prefix}ruff check .`, 'ruff config');
    add('format', `${prefix}ruff format --check .`, 'ruff config');
  }
  if (/\[tool\.mypy/.test(pyproject) || existsSync(join(root, 'mypy.ini')) || all.includes('mypy')) add('typecheck', `${prefix}mypy .`, 'mypy config');
  else if (/\[tool\.pyright/.test(pyproject) || existsSync(join(root, 'pyrightconfig.json'))) add('typecheck', `${prefix}pyright`, 'pyright config');
  if (all.includes('pytest') || existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'conftest.py')) || existsSync(join(root, 'tests'))) {
    out.testFrameworks.add('pytest');
    add('test', `${prefix}pytest -q`, 'pytest');
  }
  if (onPath('pip-audit')) add('security', 'pip-audit', 'pip-audit on PATH', { network: true });
}

function detectOthers(root, out) {
  const add = (kind, cmd, source, extra = {}) => out.checks.push({ id: kind, kind, cmd, cwd: '.', source, ...extra });
  if (existsSync(join(root, 'go.mod'))) {
    out.languages.add('go'); out.packageManager ||= 'go';
    add('lint', 'go vet ./...', 'go.mod'); add('test', 'go test ./...', 'go.mod'); add('build', 'go build ./...', 'go.mod');
  }
  if (existsSync(join(root, 'Cargo.toml'))) {
    out.languages.add('rust'); out.packageManager ||= 'cargo';
    add('lint', 'cargo clippy --all-targets -- -D warnings', 'Cargo.toml'); add('test', 'cargo test', 'Cargo.toml'); add('build', 'cargo build', 'Cargo.toml');
  }
  if (existsSync(join(root, 'pom.xml'))) { out.languages.add('java'); out.packageManager ||= 'maven'; add('test', 'mvn -q test', 'pom.xml'); add('build', 'mvn -q -DskipTests package', 'pom.xml'); }
  if (existsSync(join(root, 'build.gradle')) || existsSync(join(root, 'build.gradle.kts'))) {
    out.languages.add('java/kotlin'); out.packageManager ||= 'gradle';
    const g = existsSync(join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')) ? (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle';
    add('test', `${g} test`, 'gradle'); add('build', `${g} build -x test`, 'gradle');
  }
  if (ls(root).some((f) => /\.(csproj|sln)$/.test(f))) { out.languages.add('dotnet'); out.packageManager ||= 'dotnet'; add('test', 'dotnet test', '.csproj/.sln'); add('build', 'dotnet build', '.csproj/.sln'); }
  if (onPath('gitleaks')) add('secrets', 'gitleaks detect --no-banner --redact', 'gitleaks on PATH');
}

export function detect(root) {
  const out = { languages: new Set(), frameworks: new Set(), database: new Set(), testFrameworks: new Set(), ai: new Set(), checks: [], packageManager: '' };
  detectNode(root, '', out);
  const pkg = readJson(join(root, 'package.json'));
  const workspaceGlobs = [...(Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages || []),
    ...(readText(join(root, 'pnpm-workspace.yaml')).match(/-\s*['"]?([^'"\n]+)/g) || []).map((s) => s.replace(/-\s*['"]?/, ''))];
  const workspaceDirs = new Set();
  for (const g of workspaceGlobs) {
    const base = g.replace(/\/\*+$/, '');
    if (g.endsWith('*')) for (const d of ls(join(root, base))) { if (statSync(join(root, base, d)).isDirectory()) workspaceDirs.add(`${base}/${d}`); }
    else workspaceDirs.add(base);
  }
  for (const d of workspaceDirs) detectNode(root, d, out);
  detectPython(root, out);
  detectOthers(root, out);

  const workflows = ls(join(root, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);
  const ci = [...workflows, ...['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', 'bitbucket-pipelines.yml'].filter((f) => existsSync(join(root, f)))];
  const deploy = [['vercel.json', 'vercel'], ['netlify.toml', 'netlify'], ['fly.toml', 'fly'], ['render.yaml', 'render'], ['railway.json', 'railway'],
    ['Dockerfile', 'docker'], ['docker-compose.yml', 'docker-compose'], ['compose.yaml', 'docker-compose'], ['app.yaml', 'gcp-app-engine'], ['serverless.yml', 'serverless']]
    .filter(([f]) => existsSync(join(root, f))).map(([, n]) => n);
  if (ls(root).some((f) => f.endsWith('.tf')) || existsSync(join(root, 'terraform')) || existsSync(join(root, 'infra'))) deploy.push('iac');
  if (existsSync(join(root, 'k8s')) || existsSync(join(root, 'helm'))) deploy.push('kubernetes');
  for (const f of ['prisma/schema.prisma', 'migrations', 'db/migrations', 'alembic.ini']) if (existsSync(join(root, f))) out.database.add(f.includes('prisma') ? 'prisma' : 'migrations');
  const compose = readText(join(root, 'docker-compose.yml')) + readText(join(root, 'compose.yaml'));
  for (const [img, n] of [['postgres', 'postgres'], ['mysql', 'mysql'], ['mongo', 'mongodb'], ['redis', 'redis']]) if (compose.includes(`image: ${img}`)) out.database.add(n);
  const layout = ls(root).filter((f) => ['src', 'app', 'apps', 'packages', 'lib', 'server', 'client', 'api', 'web', 'tests', 'test', 'e2e'].includes(f));

  const notes = [];
  const kinds = new Set(out.checks.map((c) => c.kind));
  for (const k of ['lint', 'typecheck', 'test', 'build']) if (!kinds.has(k)) notes.push(`no ${k} command detected`);
  if (!ci.length) notes.push('no CI configuration detected');
  return {
    schema: 1,
    generatedBy: 'engineering-os eng-detect',
    languages: [...out.languages], packageManager: out.packageManager || null,
    frameworks: [...out.frameworks], testFrameworks: [...out.testFrameworks], database: [...out.database], ai: [...out.ai],
    monorepo: workspaceDirs.size > 0 || existsSync(join(root, 'turbo.json')) || existsSync(join(root, 'nx.json')),
    workspaces: [...workspaceDirs], layout, ci, deploy: [...new Set(deploy)],
    checks: out.checks, stopGate: true, notes,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const profile = detect(root);
  const target = join(root, 'docs', 'engineering', 'project-profile.json');
  if (args.includes('--write')) {
    const prev = readJson(target);
    if (prev && prev.stopGate === false) profile.stopGate = false; // preserve an explicit opt-out
    if (prev?.overrides) profile.overrides = prev.overrides; // human-curated additions survive re-detection
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(profile, null, 2)}\n`);
  }
  console.log(`STACK: ${profile.languages.join('+') || 'unknown'} · ${profile.packageManager || '-'} · ${profile.frameworks.join(', ') || 'no framework detected'}${profile.monorepo ? ' · monorepo' : ''}`);
  console.log(`CHECKS: ${profile.checks.map((c) => `${c.kind}=\`${c.cmd}\`${c.cwd !== '.' ? `@${c.cwd}` : ''}`).join(' · ') || 'none'}`);
  console.log(`CI: ${profile.ci.join(', ') || 'none'} · DEPLOY: ${profile.deploy.join(', ') || 'none'} · DATA: ${profile.database.join(', ') || 'none'} · AI: ${profile.ai.join(', ') || 'none'}`);
  if (profile.notes.length) console.log(`NOTES: ${profile.notes.join('; ')}`);
  if (args.includes('--write')) console.log(`WROTE: ${target}`);
}
