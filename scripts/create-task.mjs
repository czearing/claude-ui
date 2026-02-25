#!/usr/bin/env node
/**
 * create-task.mjs
 *
 * Creates a new task spec in the claude-code-ui board directly by writing
 * to the specs/ directory — no server required.
 *
 * Usage:
 *   node scripts/create-task.mjs --title "My Task" [options]
 *
 * Options:
 *   --title <string>     Task title (required)
 *   --spec <string>      Spec/description (inline string)
 *   --spec-file <path>   Path to a markdown file containing the spec
 *   --priority <value>   Low | Medium | High | Urgent  (default: Medium)
 *   --status <value>     Backlog | Not Started | In Progress | Review | Done  (default: Backlog)
 *   --repo-path <path>   Repo working directory to look up repoId (default: process.cwd())
 *
 * If neither --spec nor --spec-file is provided, spec content is read from stdin
 * (useful for piping multi-line content).
 *
 * Examples:
 *   node scripts/create-task.mjs --title "Fix login bug"
 *   node scripts/create-task.mjs --title "Refactor auth" --priority High --spec "See comments in auth.ts"
 *   node scripts/create-task.mjs --title "New feature" --spec-file /tmp/spec.md
 *   cat my-spec.md | node scripts/create-task.mjs --title "New feature"
 */

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = dirname(SCRIPT_DIR); // scripts/ lives inside app root
const SPECS_DIR = join(APP_DIR, "specs");
const REPOS_FILE = join(APP_DIR, "repos.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function findRepoId(repoPath) {
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
    const list = repos.map((r) => `  • ${r.name}: ${r.path}`).join("\n");
    throw new Error(
      `No repo registered for path: ${repoPath}\n\nRegistered repos:\n${list}\n\nAdd the repo via the claude-code-ui sidebar, or pass --repo-path with one of the paths above.`,
    );
  }
  return match.id;
}

async function getNextTaskId() {
  let max = 0;
  try {
    const dirs = await readdir(SPECS_DIR);
    for (const dir of dirs) {
      try {
        const s = await stat(join(SPECS_DIR, dir));
        if (!s.isDirectory()) continue;
        const files = await readdir(join(SPECS_DIR, dir));
        for (const file of files) {
          const m = /^TASK-(\d+)\.md$/.exec(file);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
          }
        }
      } catch {
        // skip unreadable subdirs
      }
    }
  } catch {
    // specs dir doesn't exist yet — that's fine
  }
  return `TASK-${String(max + 1).padStart(3, "0")}`;
}

function serializeTask(task) {
  const lines = [
    "---",
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `priority: ${task.priority}`,
    `repoId: ${task.repoId}`,
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
    "---",
    "",
  ];
  if (task.spec) lines.push(task.spec);
  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(`Usage: node scripts/create-task.mjs --title "My Task" [options]

Options:
  --title <string>     Task title (required)
  --spec <string>      Spec/description (inline)
  --spec-file <path>   Path to a markdown file containing the spec
  --priority <value>   Low | Medium | High | Urgent  (default: Medium)
  --status <value>     Backlog | "Not Started" | "In Progress" | Review | Done  (default: Backlog)
  --repo-path <path>   Repo working directory (default: cwd)

Spec can also be piped via stdin.`);
    process.exit(0);
  }

  const title = getArg("title");
  if (!title) {
    console.error("Error: --title is required\nRun with --help for usage.");
    process.exit(1);
  }

  const repoPath = getArg("repo-path") ?? process.cwd();
  const priority = getArg("priority") ?? "Medium";
  const status = getArg("status") ?? "Backlog";
  const spec = await readSpec();

  const repoId = await findRepoId(repoPath);
  const id = await getNextTaskId();
  const now = new Date().toISOString();

  const task = {
    id,
    title,
    status,
    priority,
    spec,
    repoId,
    createdAt: now,
    updatedAt: now,
  };

  const specsDir = join(SPECS_DIR, repoId);
  await mkdir(specsDir, { recursive: true });
  await writeFile(join(specsDir, `${id}.md`), serializeTask(task), "utf8");

  console.log(JSON.stringify(task, null, 2));
  console.error(`\n✓ Created ${id}: "${title}"`);
  console.error(`  → specs/${repoId}/${id}.md`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
