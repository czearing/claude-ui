import { readRepos, writeRepos } from "./repoStore";
import {
  ensureStatusDirs,
  migrateFrontmatterTasks,
  migrateRepoTasks,
  readTask,
  writeTask,
} from "./taskStore";
import { extractTextFromLexical } from "../utils/lexical";
import type { Task } from "../utils/tasks.types";

import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TASKS_FILE = join(process.cwd(), "tasks.json");

async function readLegacyTasks(): Promise<Task[]> {
  try {
    const raw = await readFile(TASKS_FILE, "utf8");
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

async function writeLegacyTasks(tasks: Task[]): Promise<void> {
  await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

export async function ensureDefaultRepo(): Promise<void> {
  const repos = await readRepos();
  if (repos.length > 0) {
    return;
  }

  const defaultRepo = {
    id: randomUUID(),
    name: "claude-code-ui",
    path: process.cwd(),
    createdAt: new Date().toISOString(),
  };
  await writeRepos([defaultRepo]);

  const tasks = await readLegacyTasks();
  const needsMigration = tasks.some(
    (t) => !(t as unknown as Record<string, unknown>)["repo"],
  );
  if (needsMigration) {
    const migrated = tasks.map((t) => {
      const record = t as unknown as Record<string, unknown>;
      if (!record["repo"]) {
        return { ...t, repo: defaultRepo.name };
      }
      return t;
    });
    await writeLegacyTasks(migrated);
  }

  const tasksFilePath = join(process.cwd(), "tasks.json");
  try {
    const raw = await readFile(tasksFilePath, "utf8");
    const legacyTasks = JSON.parse(raw) as Task[];
    for (const t of legacyTasks) {
      const existing = await readTask(t.id, t.repo);
      if (existing) {
        continue;
      }
      const migratedTask: Task = {
        ...t,
        spec: extractTextFromLexical(t.spec),
      };
      await writeTask(migratedTask);
    }
    await unlink(tasksFilePath);
    try {
      await unlink(`${tasksFilePath}.bak`);
    } catch {
      /* already gone */
    }
    console.error(
      `[tasks] Migrated ${legacyTasks.length} tasks to markdown files`,
    );
  } catch {
    // tasks.json doesn't exist — nothing to migrate
  }
}

export async function migrateAllRepos(): Promise<void> {
  const repos = await readRepos();
  const repoIdToName = new Map<string, string>();
  for (const r of repos) {
    repoIdToName.set(r.id, r.name);
  }
  for (const r of repos) {
    await ensureStatusDirs(r.name);
  }
  await ensureStatusDirs("claude-code-ui");
  await migrateRepoTasks(repoIdToName);
  await migrateFrontmatterTasks();
}
