import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "node:url";
import type { IncomingMessage } from "node:http";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const command = process.platform === "win32" ? "claude.cmd" : "claude";

const BUFFER_CAP = 500 * 1024; // 500 KB rolling buffer per session

type SessionEntry = {
  pty: pty.IPty;
  outputBuffer: Buffer[];
  bufferSize: number;
  activeWs: WebSocket | null;
};

const sessions = new Map<string, SessionEntry>();

// ─── Tasks ─────────────────────────────────────────────────────────────────────────────────

const TASKS_FILE = join(process.cwd(), "tasks.json");

type TaskStatus = "Backlog" | "Not Started" | "In Progress" | "Review" | "Done";
type TaskType = "Spec" | "Develop";
type Priority = "Low" | "Medium" | "High" | "Urgent";

interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  spec: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

const boardClients = new Set<WebSocket>();

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

function broadcastTaskEvent(event: string, data: unknown): void {
  const message = JSON.stringify({ type: event, data });
  boardClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function generateTaskId(tasks: Task[]): string {
  const maxNum = tasks.reduce((max, t) => {
    const num = parseInt(t.id.replace("TASK-", ""), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `TASK-${String(maxNum + 1).padStart(3, "0")}`;
}

function extractTextFromLexical(specJson: string): string {
  try {
    const state = JSON.parse(specJson) as { root: { children: unknown[] } };
    const texts: string[] = [];
    function walk(node: unknown): void {
      if (typeof node !== "object" || node === null) return;
      const n = node as Record<string, unknown>;
      if (n["type"] === "text" && typeof n["text"] === "string") {
        texts.push(n["text"]);
      }
      if (Array.isArray(n["children"])) {
        (n["children"] as unknown[]).forEach(walk);
      }
    }
    walk(state.root);
    return texts.join("\n");
  } catch {
    return specJson;
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function appendToBuffer(entry: SessionEntry, chunk: Buffer): void {
  entry.outputBuffer.push(chunk);
  entry.bufferSize += chunk.byteLength;
  while (entry.bufferSize > BUFFER_CAP && entry.outputBuffer.length > 1) {
    const removed = entry.outputBuffer.shift()!;
    entry.bufferSize -= removed.byteLength;
  }
}

app
  .prepare()
  .then(() => {
    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true);

        // GET /api/tasks
        if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
          const tasks = await readTasks();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(tasks));
          return;
        }

        // POST /api/tasks
        if (req.method === "POST" && parsedUrl.pathname === "/api/tasks") {
          const body = await readBody(req);
          const tasks = await readTasks();
          const now = new Date().toISOString();
          const task: Task = {
            id: generateTaskId(tasks),
            title: typeof body["title"] === "string" ? body["title"] : "",
            type: (body["type"] as TaskType) ?? "Spec",
            status: (body["status"] as TaskStatus) ?? "Backlog",
            priority: (body["priority"] as Priority) ?? "Medium",
            spec: typeof body["spec"] === "string" ? body["spec"] : "",
            createdAt: now,
            updatedAt: now,
          };
          tasks.push(task);
          await writeTasks(tasks);
          broadcastTaskEvent("task:created", task);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify(task));
          return;
        }

        // PATCH /api/tasks/:id
        if (
          req.method === "PATCH" &&
          parsedUrl.pathname?.startsWith("/api/tasks/") &&
          !parsedUrl.pathname.endsWith("/handover")
        ) {
          const id = parsedUrl.pathname.slice("/api/tasks/".length);
          const body = await readBody(req);
          const tasks = await readTasks();
          const idx = tasks.findIndex((t) => t.id === id);
          if (idx === -1) {
            res.writeHead(404);
            res.end();
            return;
          }
          tasks[idx] = {
            ...tasks[idx],
            ...body,
            id,
            updatedAt: new Date().toISOString(),
          } as Task;
          await writeTasks(tasks);
          broadcastTaskEvent("task:updated", tasks[idx]);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(tasks[idx]));
          return;
        }

        // DELETE /api/tasks/:id
        if (
          req.method === "DELETE" &&
          parsedUrl.pathname?.startsWith("/api/tasks/")
        ) {
          const id = parsedUrl.pathname.slice("/api/tasks/".length);
          const tasks = await readTasks();
          const filtered = tasks.filter((t) => t.id !== id);
          await writeTasks(filtered);
          broadcastTaskEvent("task:deleted", { id });
          res.writeHead(204);
          res.end();
          return;
        }

        // POST /api/tasks/:id/handover
        if (
          req.method === "POST" &&
          parsedUrl.pathname?.endsWith("/handover")
        ) {
          const id = parsedUrl.pathname.slice(
            "/api/tasks/".length,
            -"/handover".length,
          );
          const tasks = await readTasks();
          const idx = tasks.findIndex((t) => t.id === id);
          if (idx === -1) {
            res.writeHead(404);
            res.end();
            return;
          }
          const task = tasks[idx];
          const sessionId = randomUUID();
          const specText = extractTextFromLexical(task.spec);

          let ptyProcess: pty.IPty;
          try {
            ptyProcess = pty.spawn(
              command,
              ["--dangerously-skip-permissions"],
              {
                name: "xterm-color",
                cols: 80,
                rows: 24,
                cwd: process.cwd(),
                env: process.env as Record<string, string>,
              },
            );
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
            return;
          }

          const entry: SessionEntry = {
            pty: ptyProcess,
            outputBuffer: [],
            bufferSize: 0,
            activeWs: null,
          };
          sessions.set(sessionId, entry);

          // Send spec as initial prompt after Claude initialises (~2 s)
          if (specText.trim()) {
            setTimeout(() => {
              if (sessions.has(sessionId)) {
                ptyProcess.write(specText + "\n");
              }
            }, 2000);
          }

          ptyProcess.onData((data) => {
            const chunk = Buffer.from(data);
            const e = sessions.get(sessionId);
            if (!e) return;
            appendToBuffer(e, chunk);
            if (e.activeWs?.readyState === WebSocket.OPEN) {
              e.activeWs.send(chunk);
            }
          });

          ptyProcess.onExit(({ exitCode }) => {
            const e = sessions.get(sessionId);
            if (e?.activeWs?.readyState === WebSocket.OPEN) {
              e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
              e.activeWs.close();
            }
            sessions.delete(sessionId);

            // Auto-advance to Review
            void readTasks().then((current) => {
              const taskIdx = current.findIndex(
                (t) => t.sessionId === sessionId,
              );
              if (taskIdx !== -1 && current[taskIdx].status === "In Progress") {
                current[taskIdx] = {
                  ...current[taskIdx],
                  status: "Review",
                  updatedAt: new Date().toISOString(),
                };
                void writeTasks(current).then(() =>
                  broadcastTaskEvent("task:updated", current[taskIdx]),
                );
              }
            });
          });

          tasks[idx] = {
            ...task,
            sessionId,
            status: "In Progress",
            updatedAt: new Date().toISOString(),
          };
          await writeTasks(tasks);
          broadcastTaskEvent("task:updated", tasks[idx]);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(tasks[idx]));
          return;
        }

        // Handle DELETE /api/sessions/:id — kill the pty and remove from registry
        if (
          req.method === "DELETE" &&
          parsedUrl.pathname?.startsWith("/api/sessions/")
        ) {
          const id = parsedUrl.pathname.slice("/api/sessions/".length);
          const entry = sessions.get(id);
          if (entry) {
            entry.activeWs = null;
            entry.pty.kill();
            sessions.delete(id);
          }
          res.writeHead(204);
          res.end();
          return;
        }

        void handle(req, res, parsedUrl);
      } catch (err) {
        console.error("Request error:", err);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

    const wss = new WebSocketServer({ noServer: true });
    const boardWss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = parse(req.url ?? "", true);
      if (url.pathname === "/ws/terminal") {
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit("connection", ws, req),
        );
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

    wss.on("connection", (ws, req) => {
      const url = parse(req.url ?? "", true);
      const sessionId = url.query["sessionId"] as string | undefined;

      if (!sessionId) {
        ws.send(
          JSON.stringify({ type: "error", message: "Missing sessionId" }),
        );
        ws.close();
        return;
      }

      let entry = sessions.get(sessionId);

      if (entry) {
        // Reconnect: attach this WS, replay buffer
        entry.activeWs = ws;
        if (entry.outputBuffer.length > 0) {
          const replay = Buffer.concat(entry.outputBuffer);
          ws.send(
            JSON.stringify({ type: "replay", data: replay.toString("base64") }),
          );
        }
      } else {
        // New session: spawn pty
        let ptyProcess: pty.IPty;
        try {
          ptyProcess = pty.spawn(command, ["--dangerously-skip-permissions"], {
            name: "xterm-color",
            cols: 80,
            rows: 24,
            cwd: process.cwd(),
            env: process.env as Record<string, string>,
          });
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: String(err) }));
          ws.close();
          return;
        }

        entry = {
          pty: ptyProcess,
          outputBuffer: [],
          bufferSize: 0,
          activeWs: ws,
        };
        sessions.set(sessionId, entry);

        ptyProcess.onData((data) => {
          const chunk = Buffer.from(data);
          const e = sessions.get(sessionId)!;
          appendToBuffer(e, chunk);
          if (e.activeWs?.readyState === WebSocket.OPEN) {
            e.activeWs.send(chunk);
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          const e = sessions.get(sessionId);
          if (e?.activeWs?.readyState === WebSocket.OPEN) {
            e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
            e.activeWs.close();
          }
          sessions.delete(sessionId);
        });
      }

      ws.on("message", (data, isBinary) => {
        const e = sessions.get(sessionId);
        if (!e) return;
        if (isBinary) {
          e.pty.write(Buffer.from(data as ArrayBuffer).toString());
        } else {
          const text = (data as Buffer).toString("utf8");
          try {
            const msg = JSON.parse(text) as {
              type: string;
              cols?: number;
              rows?: number;
            };
            if (msg.type === "resize" && msg.cols && msg.rows) {
              e.pty.resize(msg.cols, msg.rows);
              return;
            }
          } catch {
            // not JSON — write raw to PTY
          }
          e.pty.write(text);
        }
      });

      ws.on("close", () => {
        const e = sessions.get(sessionId);
        if (e) {
          e.activeWs = null;
          // Do NOT kill pty — session stays alive
        }
      });
    });

    server.listen(port, () => {
      console.error(`> Ready on http://localhost:${port}`);
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
