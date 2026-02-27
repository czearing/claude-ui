import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos } from "../repoStore";
import {
  deleteTaskFile,
  getUniqueTaskId,
  readAllTasks,
  readTasksForRepo,
  writeTask,
} from "../taskStore";

import { extractTextFromLexical } from "../../utils/lexical";
import { readBody } from "../../utils/readBody";
import type { Task } from "../../utils/tasks.types";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { parse } from "node:url";

const PTY_MANAGER_PORT = parseInt(process.env.PTY_MANAGER_PORT ?? "3001", 10);

export async function handleTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: ReturnType<typeof parse>,
): Promise<boolean> {
  // GET /api/tasks
  if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
    const repo = parsedUrl.query["repo"] as string | undefined;
    const result = repo ? await readTasksForRepo(repo) : await readAllTasks();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return true;
  }

  // POST /api/tasks
  if (req.method === "POST" && parsedUrl.pathname === "/api/tasks") {
    const body = await readBody(req);
    const title = typeof body["title"] === "string" ? body["title"] : "";
    const repo =
      typeof body["repo"] === "string" ? body["repo"] : "claude-code-ui";
    const id = await getUniqueTaskId(title, repo);
    const task: Task = {
      id,
      title,
      status: "Backlog",
      spec: typeof body["spec"] === "string" ? body["spec"] : "",
      repo,
    };
    await writeTask(task);
    broadcastTaskEvent("task:created", task);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(task));
    return true;
  }

  // PATCH /api/tasks/:id (not /handover)
  if (
    req.method === "PATCH" &&
    parsedUrl.pathname?.startsWith("/api/tasks/") &&
    !parsedUrl.pathname.endsWith("/handover")
  ) {
    const id = parsedUrl.pathname.slice("/api/tasks/".length);
    const body = await readBody(req);
    const repoParam = parsedUrl.query["repo"] as string | undefined;
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
        ? (existing.archivedAt ?? now) // stamp once; don't overwrite if already set
        : leavingDone
          ? undefined // clear when restoring
          : existing.archivedAt, // unchanged
    } as Task;
    if (becomingDone || leavingDone) {
      delete updated.sessionId;
    }
    await writeTask(updated, prevStatus);
    broadcastTaskEvent("task:updated", updated);
    if (becomingDone && existing.sessionId) {
      await fetch(
        `http://localhost:${PTY_MANAGER_PORT}/sessions/${existing.sessionId}/kill`,
        { method: "POST" },
      ).catch(() => {});
    }
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
    const repoParam = parsedUrl.query["repo"] as string | undefined;
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
    const existing = await readAllTasks().then((ts) =>
      ts.find((t) => t.id === id),
    );
    if (!existing) {
      res.writeHead(404);
      res.end();
      return true;
    }
    const oldSessionId = existing.sessionId;
    const prevStatus = existing.status;
    const updatedTask: Task = {
      ...existing,
      status: "Backlog",
    };
    delete updatedTask.sessionId;
    await writeTask(updatedTask, prevStatus);
    broadcastTaskEvent("task:updated", updatedTask);
    if (oldSessionId) {
      await fetch(
        `http://localhost:${PTY_MANAGER_PORT}/sessions/${oldSessionId}/kill`,
        { method: "POST" },
      ).catch(() => {});
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updatedTask));
    return true;
  }

  // POST /api/tasks/:id/handover
  if (req.method === "POST" && parsedUrl.pathname?.endsWith("/handover")) {
    const id = parsedUrl.pathname.slice(
      "/api/tasks/".length,
      -"/handover".length,
    );
    const task = await readAllTasks().then((ts) => ts.find((t) => t.id === id));
    if (!task) {
      res.writeHead(404);
      res.end();
      return true;
    }
    const sessionId = randomUUID();
    // Build the prompt: spec body only (extracted from Lexical JSON
    // or passed through as plain text), then append file management instructions.
    const plainSpec = extractTextFromLexical(task.spec);
    const specText = plainSpec.trim();

    // Empty spec — nothing for Claude to do; advance straight to Review.
    if (!specText) {
      const prevStatus = task.status;
      const reviewTask: Task = {
        ...task,
        status: "Review",
      };
      await writeTask(reviewTask, prevStatus);
      broadcastTaskEvent("task:updated", reviewTask);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reviewTask));
      return true;
    }

    // Look up the repo path for this task
    const repos = await readRepos();
    const repo = repos.find((r) => r.name === task.repo);
    const cwd = repo?.path ?? process.cwd();

    // Delegate PTY spawning to the long-lived pty-manager process so the
    // Claude session survives future hot-reloads of this server.
    // The Stop hook (configured by pty-manager via claudeHookSettings) signals
    // task completion — no file-move instructions needed in the spec.
    let ptymgrRes: Response;
    try {
      ptymgrRes = await fetch(`http://localhost:${PTY_MANAGER_PORT}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, spec: specText, cwd }),
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Failed to reach pty-manager: ${String(err)}`,
        }),
      );
      return true;
    }
    if (!ptymgrRes.ok) {
      const errText = await ptymgrRes.text();
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: errText }));
      return true;
    }

    const prevStatus = task.status;
    const inProgressTask: Task = {
      ...task,
      sessionId,
      status: "In Progress",
    };
    await writeTask(inProgressTask, prevStatus);
    broadcastTaskEvent("task:updated", inProgressTask);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(inProgressTask));
    return true;
  }

  // DELETE /api/sessions/:id — proxy kill to pty-manager
  if (
    req.method === "DELETE" &&
    parsedUrl.pathname?.startsWith("/api/sessions/")
  ) {
    const id = parsedUrl.pathname.slice("/api/sessions/".length);
    await fetch(`http://localhost:${PTY_MANAGER_PORT}/sessions/${id}`, {
      method: "DELETE",
    }).catch(() => {});
    res.writeHead(204);
    res.end();
    return true;
  }

  // POST /api/internal/sessions/:id/advance-to-review
  // Called by pty-manager when it detects a session is ready for review.
  if (
    req.method === "POST" &&
    parsedUrl.pathname?.startsWith("/api/internal/sessions/") &&
    parsedUrl.pathname.endsWith("/advance-to-review")
  ) {
    const id = parsedUrl.pathname.slice(
      "/api/internal/sessions/".length,
      -"/advance-to-review".length,
    );
    const current = await readAllTasks();
    const task = current.find((t) => t.sessionId === id);
    if (task?.status === "In Progress") {
      const prevStatus = task.status;
      const updated: Task = {
        ...task,
        status: "Review",
      };
      await writeTask(updated, prevStatus);
      broadcastTaskEvent("task:updated", updated);
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  // POST /api/internal/sessions/:id/back-to-in-progress
  // Called by pty-manager when the user sends input after a task has already
  // advanced to Review — moves the task back to "In Progress".
  if (
    req.method === "POST" &&
    parsedUrl.pathname?.startsWith("/api/internal/sessions/") &&
    parsedUrl.pathname.endsWith("/back-to-in-progress")
  ) {
    const id = parsedUrl.pathname.slice(
      "/api/internal/sessions/".length,
      -"/back-to-in-progress".length,
    );
    const current = await readAllTasks();
    const task = current.find((t) => t.sessionId === id);
    if (task?.status === "Review") {
      const prevStatus = task.status;
      const updated: Task = {
        ...task,
        status: "In Progress",
      };
      await writeTask(updated, prevStatus);
      broadcastTaskEvent("task:updated", updated);
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
