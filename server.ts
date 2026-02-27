import next from "next";
import { WebSocketServer } from "ws";

import { boardClients, broadcastTaskEvent } from "./src/server/boardBroadcast";
import { readRepos, writeRepos } from "./src/server/repoStore";
import { handleAgentRoutes } from "./src/server/routes/agents";
import { handleRepoRoutes } from "./src/server/routes/repos";
import { handleSkillRoutes } from "./src/server/routes/skills";
import { handleTaskRoutes } from "./src/server/routes/tasks";
import {
  ensureStatusDirs,
  FOLDER_STATUS,
  invalidateRepoCache,
  migrateFrontmatterTasks,
  migrateRepoTasks,
  readAllTasks,
  readTask,
  SPECS_DIR,
  suppressWatchEvents,
  writeTask,
} from "./src/server/taskStore";
import { handleTerminalUpgrade } from "./src/server/wsProxy";
import { extractTextFromLexical } from "./src/utils/lexical";
import type { Task } from "./src/utils/tasks.types";

import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const PTY_MANAGER_PORT = parseInt(process.env.PTY_MANAGER_PORT ?? "3001", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

// ─── Legacy tasks.json helpers (migration only) ───────────────────────────────

const TASKS_FILE = join(process.cwd(), "tasks.json");

async function readTasks(): Promise<Task[]> {
  try {
    const raw = await readFile(TASKS_FILE, "utf8");
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

async function writeTasks(tasks: Task[]): Promise<void> {
  await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

// ─── Default repo / migration ─────────────────────────────────────────────────

async function ensureDefaultRepo(): Promise<void> {
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

  // Migrate existing tasks that have no repo
  const tasks = await readTasks();
  const needsMigration = tasks.some(
    (t) => !(t as Record<string, unknown>)["repo"],
  );
  if (needsMigration) {
    const migrated = tasks.map((t) => {
      const record = t as Record<string, unknown>;
      if (!record["repo"]) {
        return { ...t, repo: defaultRepo.name };
      }
      return t;
    });
    await writeTasks(migrated);
  }

  // Migrate tasks.json → individual markdown files
  const tasksFilePath = join(process.cwd(), "tasks.json");
  try {
    const raw = await readFile(tasksFilePath, "utf8");
    const legacyTasks = JSON.parse(raw) as Task[];
    for (const t of legacyTasks) {
      const existing = await readTask(t.id, t.repo);
      if (existing) {
        continue; // already migrated
      }
      const migratedTask: Task = {
        ...t,
        spec: extractTextFromLexical(t.spec), // convert Lexical JSON → plain text
      };
      await writeTask(migratedTask);
    }
    // Delete tasks.json so migration doesn't re-run
    await unlink(tasksFilePath);
    // Clean up any existing .bak file from a previous migration run
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

// ─── Folder-based status migration ───────────────────────────────────────────

async function migrateAllRepos(): Promise<void> {
  const repos = await readRepos();
  // Build repoId→name map for migration
  const repoIdToName = new Map<string, string>();
  for (const r of repos) {
    repoIdToName.set(r.id, r.name);
  }

  // Ensure status dirs for each known repo
  for (const r of repos) {
    await ensureStatusDirs(r.name);
  }
  // Also ensure default in case it doesn't exist yet
  await ensureStatusDirs("claude-code-ui");

  await migrateRepoTasks(repoIdToName);
  await migrateFrontmatterTasks();
}

// ─── File watcher for external task edits ─────────────────────────────────────

function setupTaskFileWatcher(): void {
  const watchDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  try {
    watch(SPECS_DIR, { recursive: true }, (event, filename) => {
      if (event !== "rename" || !filename) {
        return;
      }
      const normalized = filename.replace(/\\/g, "/");
      const parts = normalized.split("/");
      // parts: [repoName, statusFolder, taskFile]
      if (parts.length < 3) {
        return;
      }
      const [repoName, folder, taskFile] = parts;
      if (!FOLDER_STATUS[folder]) {
        return;
      }
      if (!taskFile?.endsWith(".md")) {
        return;
      }
      const taskId = taskFile.slice(0, -3);
      const existing = watchDebounceTimers.get(taskId);
      if (existing) {
        clearTimeout(existing);
      }
      watchDebounceTimers.set(
        taskId,
        setTimeout(async () => {
          watchDebounceTimers.delete(taskId);
          if (suppressWatchEvents.has(taskId)) {
            return;
          }
          const task = await readTask(taskId, repoName);
          if (task) {
            invalidateRepoCache(task.repo);
            broadcastTaskEvent("task:updated", task);
          }
        }, 100),
      );
    });
  } catch {
    // SPECS_DIR may not exist yet - watcher will not fire for non-existent dirs
  }
}

// ─── Startup recovery ─────────────────────────────────────────────────────────

/**
 * Advance any "In Progress" tasks whose PTY sessions are no longer live in
 * the pty-manager.  Runs once after the server starts listening so that tasks
 * persisted as "In Progress" from a previous run are not left stuck forever.
 *
 * If the pty-manager reports a session as live we leave it alone — Claude may
 * still be actively working.  If the pty-manager is unreachable we treat every
 * "In Progress" task as stale and advance them all.
 */
async function recoverInProgressTasks(): Promise<void> {
  const tasks = await readAllTasks();
  const stuckTasks = tasks.filter(
    (t) => t.status === "In Progress" && t.sessionId,
  );
  if (!stuckTasks.length) {
    return;
  }

  let liveSessions = new Set<string>();
  try {
    const res = await fetch(`http://localhost:${PTY_MANAGER_PORT}/sessions`);
    if (res.ok) {
      const data = (await res.json()) as { sessions: string[] };
      liveSessions = new Set(data.sessions);
    }
  } catch {
    // pty-manager not reachable — treat all "In Progress" tasks as stale
  }

  for (const task of stuckTasks) {
    if (!liveSessions.has(task.sessionId!)) {
      const prevStatus = task.status;
      const updated: Task = {
        ...task,
        status: "Review",
        updatedAt: new Date().toISOString(),
      };
      await writeTask(updated, prevStatus);
      broadcastTaskEvent("task:updated", updated);
    }
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────

app
  .prepare()
  .then(async () => {
    await ensureDefaultRepo();
    await migrateAllRepos();

    // Must be obtained after prepare() so Next.js internals are ready.
    // Handles HMR WebSocket connections (/_next/webpack-hmr) and any other
    // upgrade paths that Next.js owns.
    const nextUpgradeHandler = app.getUpgradeHandler();

    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true);
        if (await handleTaskRoutes(req, res, parsedUrl)) {
          return;
        }
        if (await handleSkillRoutes(req, res, parsedUrl)) {
          return;
        }
        if (await handleAgentRoutes(req, res, parsedUrl)) {
          return;
        }
        if (await handleRepoRoutes(req, res, parsedUrl)) {
          return;
        }
        void handle(req, res, parsedUrl);
      } catch (err) {
        console.error("Request error:", err);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

    // WebSocket server for board broadcasts (task events)
    const boardWss = new WebSocketServer({ noServer: true });
    // Separate no-handler WSS used only to upgrade terminal connections before
    // proxying them to pty-manager.
    const terminalWss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = parse(req.url ?? "", true);
      if (url.pathname === "/ws/terminal") {
        handleTerminalUpgrade(terminalWss, req, socket, head, PTY_MANAGER_PORT);
      } else if (url.pathname === "/ws/board") {
        boardWss.handleUpgrade(req, socket, head, (ws) =>
          boardWss.emit("connection", ws, req),
        );
      } else {
        // Delegate to Next.js for internal WebSocket connections such as
        // /_next/webpack-hmr (HMR in development). Previously this branch
        // called socket.destroy(), which killed every HMR connection and
        // caused Next.js to fall back to a full hard page reload after
        // repeated failures — the random "page refresh" during editing.
        void nextUpgradeHandler(req, socket, head);
      }
    });

    boardWss.on("connection", (ws) => {
      boardClients.add(ws);
      ws.on("close", () => boardClients.delete(ws));
    });

    server.listen(port, () => {
      console.error(`> Ready on http://localhost:${port}`);
      setupTaskFileWatcher();
      void recoverInProgressTasks();
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
