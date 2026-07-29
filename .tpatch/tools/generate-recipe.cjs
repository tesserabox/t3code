#!/usr/bin/env node
/**
 * generate-recipe.js — Build a tpatch apply-recipe.json from a git diff range.
 *
 * Usage:
 *   node .tpatch/tools/generate-recipe.js <slug> <from-ref> <to-ref> [-- file1 file2 ...]
 *
 * Examples:
 *   # From a commit range (all files)
 *   node .tpatch/tools/generate-recipe.js copilot-skill-discovery HEAD~2 HEAD
 *
 *   # Scoped to specific files
 *   node .tpatch/tools/generate-recipe.js my-feature main feature-branch -- apps/server/src/file.ts
 *
 * How it works:
 *   1. Runs `git diff <from>..<to>` for each file
 *   2. For new files (diff-filter=A): creates `write-file` operations with full content
 *   3. For modified files (diff-filter=M): parses unified diff hunks into `replace-in-file`
 *      operations where `search` = the before-context (from the base) and `replace` = the
 *      after-context (from the target)
 *   4. Validates each `search` string exists in the base file (`git show <from>:<path>`)
 *   5. Writes the recipe to .tpatch/features/<slug>/artifacts/apply-recipe.json
 *
 * Why this works:
 *   - tpatch recipes use `type: "replace-in-file"` with literal string search/replace
 *   - Git diff hunks naturally produce the before/after context needed
 *   - Context lines (prefixed with space in unified diff) are included in both search
 *     and replace, providing uniqueness for the match
 *   - Validation against the base file catches any parsing errors before the recipe is saved
 *
 * Limitations:
 *   - Won't work for binary files
 *   - Large hunks with many context lines may produce overly broad search strings
 *   - If the same text appears multiple times, the search may not be unique (add more context)
 *   - Files with only whitespace changes may produce empty hunks
 *
 * This is the "reverse-engineer recipe from git diff" pattern we've used successfully
 * across 13+ features in this repo. It's the pragmatic alternative to writing recipes
 * by hand or relying on tpatch's LLM implement phase (which often produces stubs).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();

function usage() {
  console.error("Usage: node generate-recipe.js <slug> <from-ref> <to-ref> [-- file1 file2 ...]");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 3) usage();

const slug = args[0];
const fromRef = args[1];
const toRef = args[2];

// Optional file scope after --
const dashIdx = args.indexOf("--");
const scopedFiles = dashIdx >= 0 ? args.slice(dashIdx + 1) : null;

const RECIPE_PATH = path.join(ROOT, `.tpatch/features/${slug}/artifacts/apply-recipe.json`);

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
}

function getFiles(filter) {
  const fileScope = scopedFiles ? "-- " + scopedFiles.join(" ") : "";
  const raw = git(`git diff --diff-filter=${filter} --name-only ${fromRef}..${toRef} ${fileScope}`).trim();
  return raw ? raw.split("\n").filter((f) => f && !f.startsWith(".tpatch")) : [];
}

function parseHunks(diffText, beforeContent) {
  const ops = [];
  const hunks = diffText.split(/^@@/m).slice(1);

  for (const hunk of hunks) {
    const lines = hunk.split("\n").slice(1); // skip the @@ header
    const search = [];
    const replace = [];
    let hasChange = false;

    for (const line of lines) {
      if (line.startsWith("\\") || line === "") continue;
      if (line[0] === "-") { search.push(line.substring(1)); hasChange = true; }
      else if (line[0] === "+") { replace.push(line.substring(1)); hasChange = true; }
      else if (line[0] === " ") { search.push(line.substring(1)); replace.push(line.substring(1)); }
    }

    if (hasChange && search.length > 0) {
      const s = search.join("\n");
      const r = replace.join("\n");
      if (s !== r && beforeContent.includes(s)) {
        ops.push({ search: s, replace: r });
      }
    }
  }
  return ops;
}

// Build operations
const operations = [];
let id = 1;

// New files → write-file
const newFiles = getFiles("A");
for (const f of newFiles) {
  const content = git(`git show ${toRef}:${f}`);
  operations.push({
    id: String(id++).padStart(2, "0"),
    type: "write-file",
    path: f,
    description: `Create ${path.basename(f)}`,
    content,
  });
}

// Modified files → replace-in-file
const modFiles = getFiles("M");
for (const f of modFiles) {
  const before = git(`git show ${fromRef}:${f}`);
  const diff = git(`git diff ${fromRef}..${toRef} -- ${f}`);
  const hunks = parseHunks(diff, before);
  for (const hunk of hunks) {
    operations.push({
      id: String(id++).padStart(2, "0"),
      type: "replace-in-file",
      path: f,
      description: `Modify ${path.basename(f)}`,
      search: hunk.search,
      replace: hunk.replace,
    });
  }
}

// Validate
let errors = 0;
for (const op of operations) {
  if (op.type === "replace-in-file") {
    try {
      const content = git(`git show ${fromRef}:${op.path}`);
      if (!content.includes(op.search)) {
        errors++;
        console.error(`  SEARCH NOT FOUND: ${op.path} (op ${op.id})`);
      }
    } catch {
      errors++;
      console.error(`  FILE NOT IN BASE: ${op.path}`);
    }
  }
}

// Write recipe
const recipe = {
  feature: slug,
  version: 1,
  description: `Auto-generated recipe from git diff ${fromRef}..${toRef}`,
  operations,
};

fs.mkdirSync(path.dirname(RECIPE_PATH), { recursive: true });
fs.writeFileSync(RECIPE_PATH, JSON.stringify(recipe, null, 2));

const writes = operations.filter((o) => o.type === "write-file").length;
const replaces = operations.length - writes;
console.log(`${slug}: ${operations.length} ops (${writes} write, ${replaces} replace), ${errors} errors`);
console.log(`  → ${RECIPE_PATH}`);

if (errors > 0) {
  process.exit(1);
}
