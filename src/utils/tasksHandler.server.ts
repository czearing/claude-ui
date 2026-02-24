import { broadcast } from "./boardBroadcast.server.js";
import { spawnAgent } from "./taskAgent.server.js";
import {
  createTask,
  deleteTask,
  getAllTasks,
  getTask,
  updateTask,
} from "./tasks.server.js";
import type { TaskPatch } from "./tasks.server.js";

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";

const LOG_DIR = resolve(process.cwd(), "task-logs");

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Returns true if the request was handled. */
export async function handleTasksRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const { method } = req;

  // GET /api/tasks
  if (method === "GET" && pathname === "/api/tasks") {
    json(res, 200, getAllTasks());
    return true;
  }

  // POST /api/tasks
  if (method === "POST" && pathname === "/api/tasks") {
    const raw = await readBody(req);
    let body: { title?: unknown; description?: unknown };
    try {
      body = JSON.parse(raw) as { title?: unknown; description?: unknown };
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return true;
    }
    if (typeof body.title !== "string" || body.title.trim() === "") {
      json(res, 400, { error: "title is required" });
      return true;
    }
    const desc =
      typeof body.description === "string" ? body.description : undefined;
    const task = createTask(body.title.trim(), desc);
    broadcast({ type: "task_created", task });
    json(res, 201, task);
    return true;
  }

  // Routes with :id
  const idMatch = pathname.match(/^\/api\/tasks\/([^/]+)(\/log)?$/);
  if (!idMatch) {
    return false;
  }
  const [, taskId, logSuffix] = idMatch;

  // GET /api/tasks/:id/log
  if (method === "GET" && logSuffix === "/log") {
    const logPath = resolve(LOG_DIR, `${taskId}.log`);
    let contents = "";
    try {
      contents = readFileSync(logPath, "utf8");
    } catch {
      // file not found — return empty string
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(contents);
    return true;
  }

  // PATCH /api/tasks/:id
  if (method === "PATCH" && !logSuffix) {
    const existing = getTask(taskId);
    if (!existing) {
      json(res, 404, { error: "Not found" });
      return true;
    }
    const raw = await readBody(req);
    let body: TaskPatch;
    try {
      body = JSON.parse(raw) as TaskPatch;
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return true;
    }
    const allowedKeys: (keyof TaskPatch)[] = [
      "title",
      "status",
      "columnOrder",
      "description",
      "tags",
    ];
    const patch: TaskPatch = {};
    for (const key of allowedKeys) {
      if (key in body) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (patch as any)[key] = (body as any)[key];
      }
    }
    const movingToNotStarted =
      patch.status === "not_started" && existing.status !== "not_started";
    const updated = updateTask(taskId, patch);
    if (!updated) {
      json(res, 404, { error: "Not found" });
      return true;
    }
    broadcast({ type: "task_updated", task: updated });
    if (movingToNotStarted) {
      void spawnAgent(taskId);
    }
    json(res, 200, updated);
    return true;
  }

  // DELETE /api/tasks/:id
  if (method === "DELETE" && !logSuffix) {
    const existed = deleteTask(taskId);
    if (!existed) {
      json(res, 404, { error: "Not found" });
      return true;
    }
    broadcast({ type: "task_deleted", taskId });
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
