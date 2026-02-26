import next from "next";
import { WebSocketServer } from "ws";

import { boardClients } from "./src/server/boardBroadcast";
import { readRepos, writeRepos } from "./src/server/repoStore";
import { handleAgentRoutes } from "./src/server/routes/agents";
import { handleRepoRoutes } from "./src/server/routes/repos";
import { handleSkillRoutes } from "./src/server/routes/skills";
import { handleTaskRoutes } from "./src/server/routes/tasks";
import { readTask, writeTask } from "./src/server/taskStore";
import { handleTerminalUpgrade } from "./src/server/wsProxy";
import { extractTextFromLexical } from "./src/utils/lexical";
import type { Task } from "./src/utils/tasks.types";

import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
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
    name: "Default",
    path: process.cwd(),
    createdAt: new Date().toISOString(),
  };
  await writeRepos([defaultRepo]);

  // Migrate existing tasks that have no repoId
  const tasks = await readTasks();
  const needsMigration = tasks.some((t) => !t.repoId);
  if (needsMigration) {
    const migrated = tasks.map((t) =>
      t.repoId ? t : { ...t, repoId: defaultRepo.id },
    );
    await writeTasks(migrated);
  }

  // Migrate tasks.json → individual markdown files
  const tasksFilePath = join(process.cwd(), "tasks.json");
  try {
    const raw = await readFile(tasksFilePath, "utf8");
    const legacyTasks = JSON.parse(raw) as Task[];
    for (const t of legacyTasks) {
      const existing = await readTask(t.id, t.repoId);
      if (existing) {
        continue; // already migrated
      }
      const migratedTask: Task = {
        ...t,
        spec: extractTextFromLexical(t.spec), // convert Lexical JSON → plain text
      };
      await writeTask(migratedTask);
    }
    // Rename tasks.json → tasks.json.bak so migration doesn't re-run
    await rename(tasksFilePath, `${tasksFilePath}.bak`);
    console.error(
      `[tasks] Migrated ${legacyTasks.length} tasks to markdown files`,
    );
  } catch {
    // tasks.json doesn't exist — nothing to migrate
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────

app
  .prepare()
  .then(async () => {
    await ensureDefaultRepo();

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
        socket.destroy();
      }
    });

    boardWss.on("connection", (ws) => {
      boardClients.add(ws);
      ws.on("close", () => boardClients.delete(ws));
    });

    server.listen(port, () => {
      console.error(`> Ready on http://localhost:${port}`);
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
