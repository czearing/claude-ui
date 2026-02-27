import {
  clearAllTaskStateCache,
  deleteTaskState,
  getAllTaskStates,
  getTaskState,
  setTaskState,
} from "./taskStateStore";
import { parseTaskFile, serializeTaskFile } from "../utils/taskFile";
import type { Task, TaskStatus } from "../utils/tasks.types";
import { slugifyTitle } from "../utils/taskSlug";

import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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

const repoCache = new Map<string, Task[]>();

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

/**
 * Migrate tasks from the old flat-status structure:
 *   specs/{statusFolder}/TASK-*.md  ->  specs/{repo}/{statusFolder}/TASK-*.md
 */
export async function migrateRepoTasks(
  repoIdToName: Map<string, string>,
): Promise<void> {
  let topDirs: string[];
  try {
    topDirs = await readdir(SPECS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {return;}
    throw err;
  }

  const oldStatusFolders = ["backlog", "in-progress", "review", "done"];
  for (const folder of oldStatusFolders) {
    if (!topDirs.includes(folder)) {continue;}
    const dir = join(SPECS_DIR, folder);
    let isDir: boolean;
    try {
      const s = await stat(dir);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) {continue;}

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    const taskFiles = files.filter((f) => f.endsWith(".md"));
    for (const filename of taskFiles) {
      const srcPath = join(dir, filename);
      let raw: string;
      try {
        raw = await readFile(srcPath, "utf8");
      } catch {
        continue;
      }

      const repoIdMatch = /^repoId:\s*(.+)$/m.exec(raw);
      const repoId = repoIdMatch?.[1]?.trim() ?? "";
      const repoName = repoIdToName.get(repoId) ?? "claude-code-ui";

      const newFolder = STATUS_FOLDERS.includes(
        folder as (typeof STATUS_FOLDERS)[number],
      )
        ? folder
        : "backlog";

      const migrated = raw.replace(/^repoId:.*\n?/m, "");

      const destDir = join(SPECS_DIR, repoName, newFolder);
      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, filename);
      try {
        await writeFile(destPath, migrated, "utf8");
        await unlink(srcPath);
      } catch {
        // dest may already exist -- skip
      }
    }
  }

  for (const entry of topDirs) {
    if (oldStatusFolders.includes(entry)) {continue;}
    if (STATUS_FOLDERS.includes(entry as (typeof STATUS_FOLDERS)[number]))
      {continue;}

    const repoDir = join(SPECS_DIR, entry);
    let isDir: boolean;
    try {
      const s = await stat(repoDir);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) {continue;}

    const repoName = repoIdToName.get(entry) ?? entry;

    for (const folder of [...oldStatusFolders, ...STATUS_FOLDERS]) {
      const nestedDir = join(repoDir, folder);
      let files: string[];
      try {
        files = await readdir(nestedDir);
      } catch {
        continue;
      }

      const taskFiles = files.filter((f) => f.endsWith(".md"));
      for (const filename of taskFiles) {
        const srcPath = join(nestedDir, filename);
        const newFolder = STATUS_FOLDERS.includes(
          folder as (typeof STATUS_FOLDERS)[number],
        )
          ? folder
          : "backlog";
        const destDir = join(SPECS_DIR, repoName, newFolder);
        await mkdir(destDir, { recursive: true });
        const destPath = join(destDir, filename);
        try {
          await rename(srcPath, destPath);
        } catch {
          // dest may already exist -- skip
        }
      }
    }

    let repoFiles: string[];
    try {
      repoFiles = await readdir(repoDir);
    } catch {
      continue;
    }

    const flatMd = repoFiles.filter((f) => f.endsWith(".md"));
    for (const filename of flatMd) {
      const srcPath = join(repoDir, filename);
      let raw: string;
      try {
        raw = await readFile(srcPath, "utf8");
      } catch {
        continue;
      }

      const statusMatch = /^status:\s*(.+)$/m.exec(raw);
      const rawStatus = statusMatch?.[1]?.trim() as TaskStatus | undefined;
      const resolvedStatus: TaskStatus =
        rawStatus && STATUS_FOLDER[rawStatus] !== undefined
          ? rawStatus
          : "Backlog";
      const folder = STATUS_FOLDER[resolvedStatus];

      let migrated = raw.replace(/^status:.*\n?/m, "");
      migrated = migrated.replace(/^repoId:.*\n?/m, "");

      const destDir = join(SPECS_DIR, repoName, folder);
      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, filename);
      await writeFile(destPath, migrated, "utf8");
      await unlink(srcPath);
    }
  }

  repoCache.clear();
}

/**
 * Migrate frontmatter-based task files to the new plain format.
 *
 * For each .md file, if it starts with `---` it still has frontmatter.
 * Strip it, extract title/sessionId/archivedAt, rename file to slug,
 * and save state to the sidecar.
 */
export async function migrateFrontmatterTasks(): Promise<void> {
  let repoDirs: string[];
  try {
    repoDirs = await readdir(SPECS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {return;}
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
    if (!isDir) {continue;}

    for (const folder of STATUS_FOLDERS) {
      const dir = join(repoDir, folder);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }

      for (const filename of files) {
        if (!filename.endsWith(".md")) {continue;}
        const filePath = join(dir, filename);
        let raw: string;
        try {
          raw = await readFile(filePath, "utf8");
        } catch {
          continue;
        }

        if (!raw.startsWith("---\n")) {continue;}

        // Parse old frontmatter
        const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
        if (!match) {continue;}

        const frontmatter = match[1];
        const body = match[2].trim();

        const meta: Record<string, string> = {};
        for (const line of frontmatter.split("\n")) {
          const idx = line.indexOf(": ");
          if (idx === -1) {continue;}
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 2).trim();
          if (key) {meta[key] = value;}
        }

        const oldId = filename.slice(0, -3);
        const title = meta["title"] ?? oldId;
        const newId = slugifyTitle(title);
        const targetId = newId || oldId;

        // Save sessionId/archivedAt to sidecar
        const stateEntry: { sessionId?: string; archivedAt?: string } = {};
        if (meta["sessionId"]) {stateEntry.sessionId = meta["sessionId"];}
        if (meta["archivedAt"]) {stateEntry.archivedAt = meta["archivedAt"];}
        if (Object.keys(stateEntry).length > 0) {
          await setTaskState(repoName, targetId, stateEntry);
        }

        // Write the plain file (body only)
        if (targetId !== oldId) {
          const newPath = join(dir, `${targetId}.md`);
          await writeFile(newPath, body, "utf8");
          await unlink(filePath);
        } else {
          await writeFile(filePath, body, "utf8");
        }
      }
    }
  }

  repoCache.clear();
}

export async function readTask(id: string, repo: string): Promise<Task | null> {
  for (const folder of STATUS_FOLDERS) {
    const filePath = join(SPECS_DIR, repo, folder, `${id}.md`);
    try {
      const raw = await readFile(filePath, "utf8");
      const folderStatus = FOLDER_STATUS[folder];
      const task = parseTaskFile(raw, repo, id, folderStatus);
      const state = await getTaskState(repo, id);
      if (state.sessionId) {task.sessionId = state.sessionId;}
      if (state.archivedAt) {task.archivedAt = state.archivedAt;}
      return task;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {continue;}
      throw err;
    }
  }
  return null;
}

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
    if (code === "ENOENT") {return;}
    if (code === "EPERM" && process.platform === "win32") {
      await new Promise((r) => setTimeout(r, 150));
      try {
        await unlink(filePath);
      } catch (retryErr) {
        if ((retryErr as NodeJS.ErrnoException).code !== "ENOENT")
          {throw retryErr;}
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

  // If prevStatus is provided and differs, delete the old file
  if (prevStatus !== undefined && prevStatus !== task.status) {
    const oldFolder = STATUS_FOLDER[prevStatus];
    const oldPath = join(SPECS_DIR, task.repo, oldFolder, `${task.id}.md`);
    await unlinkWithRetry(oldPath);
  } else {
    // No prevStatus: clean up from any other status folder
    for (const folder of STATUS_FOLDERS) {
      if (folder === targetFolder) {continue;}
      const oldPath = join(SPECS_DIR, task.repo, folder, `${task.id}.md`);
      await unlinkWithRetry(oldPath);
    }
  }

  await writeFile(targetPath, serializeTaskFile(task), "utf8");

  // Persist sessionId/archivedAt to sidecar
  await setTaskState(task.repo, task.id, {
    sessionId: task.sessionId,
    archivedAt: task.archivedAt,
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
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {throw err;}
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

export async function readTasksForRepo(repo: string): Promise<Task[]> {
  const cached = repoCache.get(repo);
  if (cached) {return cached;}

  const tasks: Task[] = [];
  const states = await getAllTaskStates(repo);

  for (const folder of STATUS_FOLDERS) {
    const dir = join(SPECS_DIR, repo, folder);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {continue;}
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
            if (state?.sessionId) {task.sessionId = state.sessionId;}
            if (state?.archivedAt) {task.archivedAt = state.archivedAt;}
            return task;
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {return null;}
            throw err;
          }
        }),
    );
    for (const t of folderTasks) {
      if (t !== null) {tasks.push(t);}
    }
  }

  repoCache.set(repo, tasks);
  return tasks;
}

export async function readAllTasks(): Promise<Task[]> {
  const allTasks: Task[] = [];

  let repoDirs: string[];
  try {
    repoDirs = await readdir(SPECS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {return [];}
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
    if (!isDir) {continue;}

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

  if (!existing.has(base)) {return base;}
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}
