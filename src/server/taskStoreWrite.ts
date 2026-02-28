import { deleteTaskState, patchTaskState } from "./taskStateStore";
import {
  repoCache,
  SPECS_DIR,
  STATUS_FOLDER,
  STATUS_FOLDERS,
  suppressWatchEvents,
} from "./taskStoreConfig";
import { serializeTaskFile } from "../utils/taskFile";
import type { Task, TaskStatus } from "../utils/tasks.types";

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Delete a file, ignoring ENOENT.  On Windows, file handles can be held
 * briefly by the OS file watcher or antivirus after a recent write, causing
 * EPERM.  Retry once after 150 ms before giving up.
 */
async function unlinkWithRetry(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return;
    }
    if (code === "EPERM" && process.platform === "win32") {
      await new Promise((r) => setTimeout(r, 150));
      try {
        await unlink(filePath);
      } catch (retryErr) {
        if ((retryErr as NodeJS.ErrnoException).code !== "ENOENT") {
          throw retryErr;
        }
      }
      return;
    }
    throw err;
  }
}

export async function writeTask(
  task: Task,
  prevStatus?: TaskStatus,
): Promise<void> {
  const targetFolder = STATUS_FOLDER[task.status];
  const targetDir = join(SPECS_DIR, task.repo, targetFolder);
  const targetPath = join(targetDir, `${task.id}.md`);

  suppressWatchEvents.add(task.id);
  setTimeout(() => suppressWatchEvents.delete(task.id), 500);

  await mkdir(targetDir, { recursive: true });

  if (prevStatus !== undefined && prevStatus !== task.status) {
    const oldFolder = STATUS_FOLDER[prevStatus];
    const oldPath = join(SPECS_DIR, task.repo, oldFolder, `${task.id}.md`);
    await unlinkWithRetry(oldPath);
  } else {
    for (const folder of STATUS_FOLDERS) {
      if (folder === targetFolder) {
        continue;
      }
      const oldPath = join(SPECS_DIR, task.repo, folder, `${task.id}.md`);
      await unlinkWithRetry(oldPath);
    }
  }

  await writeFile(targetPath, serializeTaskFile(task), "utf8");

  // Persist mutable task fields to sidecar; patchTaskState preserves
  // append-only fields (claudeSessionIds, messages) without a pre-read.
  await patchTaskState(task.repo, task.id, {
    sessionId: task.sessionId,
    archivedAt: task.archivedAt,
    title: task.title,
  });

  const cached = repoCache.get(task.repo);
  if (cached) {
    const idx = cached.findIndex((t) => t.id === task.id);
    repoCache.set(
      task.repo,
      idx >= 0
        ? [...cached.slice(0, idx), task, ...cached.slice(idx + 1)]
        : [...cached, task],
    );
  }
}

export async function deleteTaskFile(
  id: string,
  repo: string,
  status: TaskStatus,
): Promise<void> {
  const folder = STATUS_FOLDER[status];
  const filePath = join(SPECS_DIR, repo, folder, `${id}.md`);
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    return;
  }

  await deleteTaskState(repo, id);

  const cached = repoCache.get(repo);
  if (cached) {
    repoCache.set(
      repo,
      cached.filter((t) => t.id !== id),
    );
  }
}
