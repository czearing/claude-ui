import next from "next";
import { WebSocketServer } from "ws";

import { boardClients, broadcastTaskEvent } from "./src/server/boardBroadcast";
import { handleAgentRoutes } from "./src/server/routes/agents";
import { handleRepoRoutes } from "./src/server/routes/repos";
import { handleSkillRoutes } from "./src/server/routes/skills";
import { handleTaskRoutes } from "./src/server/routes/tasks";
import {
  ensureDefaultRepo,
  migrateAllRepos,
} from "./src/server/serverMigration";
import {
  FOLDER_STATUS,
  invalidateRepoCache,
  readAllTasks,
  readTask,
  SPECS_DIR,
  suppressWatchEvents,
  writeTask,
} from "./src/server/taskStore";
import type { Task } from "./src/utils/tasks.types";

import { watch } from "node:fs";
import { createServer } from "node:http";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

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
    // SPECS_DIR may not exist yet
  }
}

// ─── Startup recovery ─────────────────────────────────────────────────────────

async function recoverInProgressTasks(): Promise<void> {
  const tasks = await readAllTasks();
  const stuckTasks = tasks.filter((t) => t.status === "In Progress");
  for (const task of stuckTasks) {
    const prevStatus = task.status;
    const updated: Task = { ...task, status: "Backlog" };
    delete updated.sessionId;
    await writeTask(updated, prevStatus);
    broadcastTaskEvent("task:updated", updated);
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────

app
  .prepare()
  .then(async () => {
    await ensureDefaultRepo();
    await migrateAllRepos();

    const nextUpgradeHandler = app.getUpgradeHandler();

    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url!, "http://localhost");
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
        void handle(req, res);
      } catch (err) {
        console.error("Request error:", err);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

    const boardWss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/ws/board") {
        boardWss.handleUpgrade(req, socket, head, (ws) =>
          boardWss.emit("connection", ws, req),
        );
      } else {
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
