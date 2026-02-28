import { readRepos, writeRepos } from "./repoStore";
import { setTaskState } from "./taskStateStore";
import {
  clearTaskCache,
  ensureStatusDirs,

  readTask,
  SPECS_DIR,
  STATUS_FOLDER,
  STATUS_FOLDERS,
  writeTask,
} from "./taskStore";
import { extractTextFromLexical } from "../utils/lexical";
import type { Task, TaskStatus } from "../utils/tasks.types";
import { slugifyTitle } from "../utils/taskSlug";

import { randomUUID } from "node:crypto";
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
    console.warn(
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

/**
 * Migrate tasks from the old flat-status structure:
 *   specs/{statusFolder}/TASK-*.md  ->  specs/{repo}/{statusFolder}/TASK-*.md
 */
async function migrateRepoTasks(
  repoIdToName: Map<string, string>,
): Promise<void> {
  let topDirs: string[];
  try {
    topDirs = await readdir(SPECS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }

  const oldStatusFolders = ["backlog", "in-progress", "review", "done"];
  for (const folder of oldStatusFolders) {
    if (!topDirs.includes(folder)) {
      continue;
    }
    const dir = join(SPECS_DIR, folder);
    let isDir: boolean;
    try {
      const s = await stat(dir);
      isDir = s.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) {
      continue;
    }

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
    if (oldStatusFolders.includes(entry)) {
      continue;
    }
    if (STATUS_FOLDERS.includes(entry as (typeof STATUS_FOLDERS)[number])) {
      continue;
    }

    const repoDir = join(SPECS_DIR, entry);
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

  clearTaskCache();
}

/**
 * Migrate frontmatter-based task files to the new plain format.
 *
 * For each .md file, if it starts with `---` it still has frontmatter.
 * Strip it, extract title/sessionId/archivedAt, rename file to slug,
 * and save state to the sidecar.
 */
async function migrateFrontmatterTasks(): Promise<void> {
  let repoDirs: string[];
  try {
    repoDirs = await readdir(SPECS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
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

    for (const folder of STATUS_FOLDERS) {
      const dir = join(repoDir, folder);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }

      for (const filename of files) {
        if (!filename.endsWith(".md")) {
          continue;
        }
        const filePath = join(dir, filename);
        let raw: string;
        try {
          raw = await readFile(filePath, "utf8");
        } catch {
          continue;
        }

        if (!raw.startsWith("---\n")) {
          continue;
        }

        const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
        if (!match) {
          continue;
        }

        const frontmatter = match[1];
        const body = match[2].trim();

        const meta: Record<string, string> = {};
        for (const line of frontmatter.split("\n")) {
          const idx = line.indexOf(": ");
          if (idx === -1) {
            continue;
          }
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 2).trim();
          if (key) {
            meta[key] = value;
          }
        }

        const oldId = filename.slice(0, -3);
        const title = meta["title"] ?? oldId;
        const newId = slugifyTitle(title);
        const targetId = newId || oldId;

        const stateEntry: { sessionId?: string; archivedAt?: string } = {};
        if (meta["sessionId"]) {
          stateEntry.sessionId = meta["sessionId"];
        }
        if (meta["archivedAt"]) {
          stateEntry.archivedAt = meta["archivedAt"];
        }
        if (Object.keys(stateEntry).length > 0) {
          await setTaskState(repoName, targetId, stateEntry);
        }

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

  clearTaskCache();
}
