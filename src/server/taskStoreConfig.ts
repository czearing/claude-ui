import { clearAllTaskStateCache } from "./taskStateStore";
import type { Task, TaskStatus } from "../utils/tasks.types";

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const SPECS_DIR = join(process.cwd(), "specs");

export const STATUS_FOLDERS = [
  "backlog",
  "not-started",
  "in-progress",
  "review",
  "done",
] as const;

export const STATUS_FOLDER: Record<TaskStatus, string> = {
  Backlog: "backlog",
  "Not Started": "not-started",
  "In Progress": "in-progress",
  Review: "review",
  Done: "done",
};

export const FOLDER_STATUS: Record<string, TaskStatus> = {
  backlog: "Backlog",
  "not-started": "Not Started",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

export const suppressWatchEvents = new Set<string>();

export const repoCache = new Map<string, Task[]>();

export function invalidateRepoCache(repo: string): void {
  repoCache.delete(repo);
}

export function clearTaskCache(): void {
  repoCache.clear();
  clearAllTaskStateCache();
}

export function repoSpecsDir(repo: string): string {
  return join(SPECS_DIR, repo);
}

export function taskFilePath(
  id: string,
  repo: string,
  status: TaskStatus,
): string {
  return join(SPECS_DIR, repo, STATUS_FOLDER[status], `${id}.md`);
}

/** Ensure all 5 status directories exist under specs/{repo}/. */
export async function ensureStatusDirs(repo: string): Promise<void> {
  await Promise.all(
    STATUS_FOLDERS.map((folder) =>
      mkdir(join(SPECS_DIR, repo, folder), { recursive: true }),
    ),
  );
}
