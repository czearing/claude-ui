import { handleGetHistory, handleChat } from "./taskChat";
import { handleHandover, handleRecall, activePtys } from "./taskHandover";
import { broadcastTaskEvent } from "../boardBroadcast";
import {
  deleteTaskFile,
  getUniqueTaskId,
  readAllTasks,
  readTasksForRepo,
  writeTask,
} from "../taskStore";
import { parseStringBody } from "../utils/routeUtils";

import { readBody } from "../../utils/readBody";
import type { Task } from "../../utils/tasks.types";
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_REPO = "claude-code-ui";

export async function handleTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const query = parsedUrl.searchParams;

  // GET /api/tasks
  if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
    const repo = query.get("repo") ?? undefined;
    const result = repo ? await readTasksForRepo(repo) : await readAllTasks();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return true;
  }

  // POST /api/tasks
  if (req.method === "POST" && parsedUrl.pathname === "/api/tasks") {
    const body = await readBody(req);
    const title = parseStringBody(body, "title");
    const repo = parseStringBody(body, "repo", { fallback: DEFAULT_REPO });
    const id = await getUniqueTaskId(title, repo);
    const task: Task = {
      id,
      title,
      status: "Backlog",
      spec: parseStringBody(body, "spec"),
      repo,
    };
    await writeTask(task);
    broadcastTaskEvent("task:created", task);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(task));
    return true;
  }

  // POST /api/tasks/:id/handover
  if (
    req.method === "POST" &&
    parsedUrl.pathname?.startsWith("/api/tasks/") &&
    parsedUrl.pathname.endsWith("/handover")
  ) {
    const id = parsedUrl.pathname.slice(
      "/api/tasks/".length,
      -"/handover".length,
    );
    await handleHandover(req, res, id);
    return true;
  }

  // POST /api/tasks/:id/recall
  if (
    req.method === "POST" &&
    parsedUrl.pathname?.startsWith("/api/tasks/") &&
    parsedUrl.pathname.endsWith("/recall")
  ) {
    const id = parsedUrl.pathname.slice(
      "/api/tasks/".length,
      -"/recall".length,
    );
    await handleRecall(req, res, id);
    return true;
  }

  // GET /api/tasks/:id/history
  if (
    req.method === "GET" &&
    parsedUrl.pathname?.startsWith("/api/tasks/") &&
    parsedUrl.pathname.endsWith("/history")
  ) {
    const id = parsedUrl.pathname.slice(
      "/api/tasks/".length,
      -"/history".length,
    );
    await handleGetHistory(req, res, id);
    return true;
  }

  // POST /api/tasks/:id/chat
  if (
    req.method === "POST" &&
    parsedUrl.pathname?.startsWith("/api/tasks/") &&
    parsedUrl.pathname.endsWith("/chat")
  ) {
    const id = parsedUrl.pathname.slice("/api/tasks/".length, -"/chat".length);
    await handleChat(req, res, id);
    return true;
  }

  // DELETE /api/sessions/:id — kill active PTY if running
  if (
    req.method === "DELETE" &&
    parsedUrl.pathname?.startsWith("/api/sessions/")
  ) {
    const id = parsedUrl.pathname.slice("/api/sessions/".length);
    const active = activePtys.get(id);
    if (active) {
      try {
        active.kill();
      } catch {
        // already exited
      }
      activePtys.delete(id);
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  // PATCH /api/tasks/:id
  if (
    req.method === "PATCH" &&
    parsedUrl.pathname?.startsWith("/api/tasks/") &&
    !parsedUrl.pathname.endsWith("/handover") &&
    !parsedUrl.pathname.endsWith("/recall")
  ) {
    const id = parsedUrl.pathname.slice("/api/tasks/".length);
    const body = await readBody(req);
    const repoParam = query.get("repo") ?? undefined;
    const taskList = repoParam
      ? await readTasksForRepo(repoParam)
      : await readAllTasks();
    const existing = taskList.find((t) => t.id === id);
    if (!existing) {
      res.writeHead(404);
      res.end();
      return true;
    }
    const now = new Date().toISOString();
    const becomingDone = body.status === "Done";
    const leavingDone =
      body.status !== undefined &&
      body.status !== "Done" &&
      existing.status === "Done";

    const prevStatus = existing.status;
    const updated: Task = {
      ...existing,
      ...body,
      id,
      repo: existing.repo,
      archivedAt: becomingDone
        ? (existing.archivedAt ?? now)
        : leavingDone
          ? undefined
          : existing.archivedAt,
    } as Task;
    if (becomingDone || leavingDone) {
      delete updated.sessionId;
    }
    await writeTask(updated, prevStatus);
    broadcastTaskEvent("task:updated", updated);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // DELETE /api/tasks/:id
  if (
    req.method === "DELETE" &&
    parsedUrl.pathname?.startsWith("/api/tasks/")
  ) {
    const id = parsedUrl.pathname.slice("/api/tasks/".length);
    const repoParam = query.get("repo") ?? undefined;
    const deleteTaskList = repoParam
      ? await readTasksForRepo(repoParam)
      : await readAllTasks();
    const taskToDelete = deleteTaskList.find((t) => t.id === id);
    if (taskToDelete) {
      await deleteTaskFile(id, taskToDelete.repo, taskToDelete.status);
    }
    broadcastTaskEvent("task:deleted", {
      id,
      repo: taskToDelete?.repo,
    });
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
