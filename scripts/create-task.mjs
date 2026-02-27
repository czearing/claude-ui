#!/usr/bin/env node
/**
 * create-task.mjs
 *
 * Creates a new task spec in the claude-code-ui board directly by writing
 * to the specs/ directory -- no server required.
 *
 * Usage:
 *   node scripts/create-task.mjs --title "My Task" [options]
 *
 * Options:
 *   --title <string>     Task title (required)
 *   --spec <string>      Spec/description (inline string)
 *   --spec-file <path>   Path to a markdown file containing the spec
 *   --status <value>     Backlog | Not Started | In Progress | Review | Done  (default: Backlog)
 *   --repo <name>        Repo name (default: looks up by --repo-path or cwd)
 *   --repo-path <path>   Repo working directory to look up repo name (default: process.cwd())
 *
 * If neither --spec nor --spec-file is provided, spec content is read from stdin
 * (useful for piping multi-line content).
 *
 * Examples:
 *   node scripts/create-task.mjs --title "Fix login bug"
 *   node scripts/create-task.mjs --title "Refactor auth" --spec "See comments in auth.ts"
 *   node scripts/create-task.mjs --title "New feature" --spec-file /tmp/spec.md
 *   node scripts/create-task.mjs --title "New feature" --repo "book-cook"
 *   cat my-spec.md | node scripts/create-task.mjs --title "New feature"
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

// ── Status folder mapping ──────────────────────────────────────────────────

const STATUS_FOLDER = {
  Backlog: "backlog",
  "Not Started": "not-started",
  "In Progress": "in-progress",
  Review: "review",
  Done: "done",
};

// ── Paths ────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = dirname(SCRIPT_DIR); // scripts/ lives inside app root
const SPECS_DIR = join(APP_DIR, "specs");
const REPOS_FILE = join(APP_DIR, "repos.json");

// ── Slug helpers ────────────────────────────────────────────────────────────

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readSpec() {
  const inline = getArg("spec");
  if (inline != null) return inline;

  const specFile = getArg("spec-file");
  if (specFile) {
    const p = resolve(specFile);
    if (!existsSync(p)) {
      throw new Error(`--spec-file not found: ${p}`);
    }
    return (await readFile(p, "utf8")).trim();
  }

  // Fall back to stdin if it's piped
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  return "";
}

async function findRepoName(repoPath) {
  if (!existsSync(REPOS_FILE)) {
    throw new Error(
      `repos.json not found at ${REPOS_FILE}. Is APP_DIR correct? (${APP_DIR})`,
    );
  }
  const repos = JSON.parse(await readFile(REPOS_FILE, "utf8"));

  const normalize = (p) =>
    p.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  const target = normalize(repoPath);

  const match = repos.find((r) => normalize(r.path) === target);
  if (!match) {
    const list = repos.map((r) => `  - ${r.name}: ${r.path}`).join("\n");
    throw new Error(
      `No repo registered for path: ${repoPath}\n\nRegistered repos:\n${list}\n\nAdd the repo via the claude-code-ui sidebar, or pass --repo-path with one of the paths above.`,
    );
  }
  return match.name;
}

const STATUS_FOLDERS = [
  "backlog",
  "not-started",
  "in-progress",
  "review",
  "done",
];

async function getUniqueTaskId(title, repo) {
  const base = slugifyTitle(title) || "untitled";
  const existing = new Set();

  for (const folder of STATUS_FOLDERS) {
    const dir = join(SPECS_DIR, repo, folder);
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.endsWith(".md")) {
          existing.add(f.slice(0, -3));
        }
      }
    } catch {
      // folder may not exist
    }
  }

  if (!existing.has(base)) return base;
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(`Usage: node scripts/create-task.mjs --title "My Task" [options]

Options:
  --title <string>     Task title (required)
  --spec <string>      Spec/description (inline)
  --spec-file <path>   Path to a markdown file containing the spec
  --status <value>     Backlog | "Not Started" | "In Progress" | Review | Done  (default: Backlog)
  --repo <name>        Repo name (default: looks up by --repo-path or cwd)
  --repo-path <path>   Repo working directory (default: cwd)

Spec can also be piped via stdin.

The task id is derived from the title (slug). The file contains only the spec text, no frontmatter.`);
    process.exit(0);
  }

  const title = getArg("title");
  if (!title) {
    console.error("Error: --title is required\nRun with --help for usage.");
    process.exit(1);
  }

  const repoPath = getArg("repo-path") ?? process.cwd();
  const status = getArg("status") ?? "Backlog";
  const spec = await readSpec();

  // Use --repo if provided, otherwise look up by path
  const repo = getArg("repo") ?? (await findRepoName(repoPath));
  const id = await getUniqueTaskId(title, repo);

  const task = {
    id,
    title,
    status,
    spec,
    repo,
  };

  const statusFolder = STATUS_FOLDER[status] ?? "backlog";
  const specsDir = join(SPECS_DIR, repo, statusFolder);
  await mkdir(specsDir, { recursive: true });
  // Write plain spec content only -- no frontmatter
  await writeFile(join(specsDir, `${id}.md`), spec, "utf8");

  console.log(JSON.stringify(task, null, 2));
  console.error(`\n  Created ${id}: "${title}"`);
  console.error(`  -> specs/${repo}/${statusFolder}/${id}.md`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
