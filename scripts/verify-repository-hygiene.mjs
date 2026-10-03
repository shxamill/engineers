#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

function fail(msg) { failures.push(msg); }

function checkInternalLinks(file) {
  const text = read(file);
  const dir = path.dirname(file);
  const re = /\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  let m;
  while ((m = re.exec(text))) {
    let target = m[1];
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|tel:|data:)/i.test(target) || target.startsWith("//")) continue;
    const [rawPath] = target.split("#", 1);
    if (!rawPath) continue;
    const decoded = decodeURIComponent(rawPath);
    const resolved = path.normalize(path.join(root, dir, decoded));
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      fail(file + ": link escapes repository: " + target);
      continue;
    }
    if (!fs.existsSync(resolved)) fail(file + ": missing internal link target: " + target);
  }
}

function checkWorkflow(file) {
  const text = read(file);
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!/\buses:\s*/.test(line)) continue;
    const match = line.match(/\buses:\s*([^\s@]+)@([^\s#]+)(?:\s+#\s*(.*))?\s*$/);
    if (!match) continue;
    const [, action, ref, comment = ""] = match;
    if (action.startsWith("./") || action.startsWith("docker://")) continue;
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      fail(file + ":" + (i + 1) + ": Action must be pinned to a full commit SHA: " + action + "@" + ref);
    } else if (!/v\d/.test(comment)) {
      fail(file + ":" + (i + 1) + ": SHA-pinned Action must include a version comment: " + action);
    }
  }
}

function checkMetadata() {
  const plugin = JSON.parse(read("plugins/engineering-os/.claude-plugin/plugin.json"));
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
  if (plugin.author?.name !== "shxamill") fail("plugin manifest author is not shxamill");
  if (plugin.license !== "MIT") fail("plugin manifest license is not MIT");
  if (plugin.repository !== "https://github.com/shxamill/engineers") fail("plugin repository metadata is inconsistent");
  if (marketplace.owner?.name !== "shxamill") fail("marketplace owner is not shxamill");
  if (!exists("LICENSE")) fail("root LICENSE is missing");
  if (!read("LICENSE").startsWith("MIT License")) fail("root LICENSE is not MIT");
  if (!/^\d+\.\d+\.\d+$/.test(read(".node-version").trim())) fail(".node-version must pin an exact Node version");
  const changelog = read("plugins/engineering-os/CHANGELOG.md");
  if (!changelog.includes("## " + plugin.version + " ")) fail("plugin version " + plugin.version + " has no matching changelog entry");
  const owners = read(".github/CODEOWNERS");
  if (!/^\/\.github\/CODEOWNERS\s+@shxamill\s*$/m.test(owners)) fail("CODEOWNERS must explicitly own itself");
  if (!/^\*\s+@shxamill\s*$/m.test(owners)) fail("CODEOWNERS default owner is missing");
}

function checkStaleText() {
  const checks = [
    ["README.md", /no LICENSE file/i, "README still claims there is no LICENSE file"],
    ["README.md", /license decision by the maintainer/i, "README still lists a completed license decision as planned"],
    ["plugins/engineering-os/README.md", /no LICENSE file/i, "plugin manual still claims there is no LICENSE file"],
    ["docs/engineering/repository-maintenance.md", /Open issues: none found during the maintenance audit/i, "maintenance runbook contains an obsolete open-issue snapshot"],
    ["docs/engineering/status.md", /License decision \(human gate: legal\)/i, "engineering status contains an obsolete license task"]
  ];
  for (const [file, pattern, msg] of checks) if (pattern.test(read(file))) fail(msg);

  for (const file of [
    "README.md","CONTRIBUTING.md","SECURITY.md","SUPPORT.md","CODE_OF_CONDUCT.md",
    ".github/CODEOWNERS",".claude-plugin/marketplace.json",
    "plugins/engineering-os/.claude-plugin/plugin.json"
  ]) {
    if (/Velune Productions|veluneproductions@gmail\.com/i.test(read(file))) fail(file + ": stale Velune ownership/contact reference");
  }
}

function main() {
  const markdown = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".eng") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) markdown.push(path.relative(root, full));
    }
  }
  walk(root);
  markdown.forEach(checkInternalLinks);
  for (const file of fs.readdirSync(path.join(root, ".github/workflows"))) {
    if (file.endsWith(".yml") || file.endsWith(".yaml")) checkWorkflow(path.join(".github/workflows", file));
  }
  checkMetadata();
  checkStaleText();

  if (failures.length) {
    console.error("REPOSITORY HYGIENE: FAIL");
    for (const failure of failures) console.error(" - " + failure);
    process.exit(1);
  }
  console.log("REPOSITORY HYGIENE: PASS");
  console.log("Checked " + markdown.length + " Markdown files, workflow Action pinning, and ownership/license/version invariants.");
}

main();
