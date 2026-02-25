import { parseTaskFile, serializeTaskFile } from "../utils/taskFile";
import type { Task } from "../utils/tasks.types";

import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export const SPECS_DIR = join(process.cwd(), "specs");

export function repoSpecsDir(repoId: string): string {
  return join(SPECS_DIR, repoId);
}

export async function ensureSpecsDir(repoId: string): Promise<void> {
  await mkdir(repoSpecsDir(repoId), { recursive: true });
}

export async function readTask(
  id: string,
  repoId: string,
): Promise<Task | null> {
  try {
    const raw = await readFile(join(repoSpecsDir(repoId), `${id}.md`), "utf8");
    return parseTaskFile(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeTask(task: Task): Promise<void> {
  await ensureSpecsDir(task.repoId);
  await writeFile(
    join(repoSpecsDir(task.repoId), `${task.id}.md`),
    serializeTaskFile(task),
    "utf8",
  );
}

export async function deleteTaskFile(
  id: string,
  repoId: string,
): Promise<void> {
  try {
    await unlink(join(repoSpecsDir(repoId), `${id}.md`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }
}

export async function readTasksForRepo(repoId: string): Promise<Task[]> {
  try {
    const dir = repoSpecsDir(repoId);
    const files = await readdir(dir);
    const tasks = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map((f) => readTask(f.slice(0, -3), repoId)),
    );
    return tasks.filter((t): t is Task => t !== null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function readAllTasks(): Promise<Task[]> {
  try {
    const dirs = await readdir(SPECS_DIR);
    const groups = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const s = await stat(join(SPECS_DIR, dir));
          return s.isDirectory() ? readTasksForRepo(dir) : [];
        } catch {
          return [];
        }
      }),
    );
    return groups.flat();
  } catch {
    return [];
  }
}

export async function getNextTaskId(): Promise<string> {
  let max = 0;
  try {
    const dirs = await readdir(SPECS_DIR);
    for (const dir of dirs) {
      try {
        const s = await stat(join(SPECS_DIR, dir));
        if (!s.isDirectory()) {
          continue;
        }
        const files = await readdir(join(SPECS_DIR, dir));
        for (const file of files) {
          const m = /^TASK-(\d+)\.md$/.exec(file);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) {
              max = n;
            }
          }
        }
      } catch {
        // skip unreadable dirs
      }
    }
  } catch {
    // SPECS_DIR doesn't exist yet
  }
  return `TASK-${String(max + 1).padStart(3, "0")}`;
}
