import {
  getAllTaskStates,
  getLatestSessionId,
  getTaskState,
} from "./taskStateStore";
import {
  FOLDER_STATUS,
  repoCache,
  SPECS_DIR,
  STATUS_FOLDERS,
} from "./taskStoreConfig";
import { parseTaskFile } from "../utils/taskFile";
import type { Task } from "../utils/tasks.types";
import { slugifyTitle } from "../utils/taskSlug";

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export async function readTask(id: string, repo: string): Promise<Task | null> {
  for (const folder of STATUS_FOLDERS) {
    const filePath = join(SPECS_DIR, repo, folder, `${id}.md`);
    try {
      const raw = await readFile(filePath, "utf8");
      const folderStatus = FOLDER_STATUS[folder];
      const task = parseTaskFile(raw, repo, id, folderStatus);
      const state = await getTaskState(repo, id);
      if (state.sessionId) {
        task.sessionId = state.sessionId;
      }
      if (state.archivedAt) {
        task.archivedAt = state.archivedAt;
      }
      const latestSid = getLatestSessionId(state);
      if (latestSid) {
        task.claudeSessionId = latestSid;
      }
      if (state.title) {
        task.title = state.title;
      }
      return task;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw err;
    }
  }
  return null;
}

export async function readTasksForRepo(repo: string): Promise<Task[]> {
  const cached = repoCache.get(repo);
  if (cached) {
    return cached;
  }

  const tasks: Task[] = [];
  const states = await getAllTaskStates(repo);

  for (const folder of STATUS_FOLDERS) {
    const dir = join(SPECS_DIR, repo, folder);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw err;
    }
    const folderStatus = FOLDER_STATUS[folder];
    const folderTasks = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => {
          const filePath = join(dir, f);
          const fileId = f.slice(0, -3);
          try {
            const raw = await readFile(filePath, "utf8");
            const task = parseTaskFile(raw, repo, fileId, folderStatus);
            const state = states[fileId];
            if (state?.sessionId) {
              task.sessionId = state.sessionId;
            }
            if (state?.archivedAt) {
              task.archivedAt = state.archivedAt;
            }
            const latestSid = state ? getLatestSessionId(state) : undefined;
            if (latestSid) {
              task.claudeSessionId = latestSid;
            }
            if (state?.title) {
              task.title = state.title;
            }
            return task;
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              return null;
            }
            throw err;
          }
        }),
    );
    for (const t of folderTasks) {
      if (t !== null) {
        tasks.push(t);
      }
    }
  }

  repoCache.set(repo, tasks);
  return tasks;
}

/**
 * Find a single task by ID without scanning all repos.
 * Searches the warm in-memory cache first; falls back to a full scan only
 * when the cache is cold (first request after server start).
 */
export async function findTaskById(id: string): Promise<Task | null> {
  for (const tasks of repoCache.values()) {
    const found = tasks.find((t) => t.id === id);
    if (found) { return found; }
  }
  // Cache cold — warm it with a full scan then return
  const all = await readAllTasks();
  return all.find((t) => t.id === id) ?? null;
}

export async function readAllTasks(): Promise<Task[]> {
  const allTasks: Task[] = [];

  let repoDirs: string[];
  try {
    repoDirs = await readdir(SPECS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  for (const repoName of repoDirs) {
    const repoDir = join(SPECS_DIR, repoName);
    let isDir: boolean;
    try {
      const s = await stat(repoDir);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) {
      continue;
    }
    const repoTasks = await readTasksForRepo(repoName);
    allTasks.push(...repoTasks);
  }

  return allTasks;
}

/**
 * Generate a unique task id (slug) for a new task.
 * Checks all status folders for filename conflicts and appends -2, -3, etc.
 */
export async function getUniqueTaskId(
  title: string,
  repo: string,
): Promise<string> {
  const base = slugifyTitle(title) || "untitled";
  const existing = new Set<string>();

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

  if (!existing.has(base)) {
    return base;
  }
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}
