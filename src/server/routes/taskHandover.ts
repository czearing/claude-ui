import { activePtys, buildArgs, spawnClaude, stripAnsi } from "./taskSpawn";
import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos } from "../repoStore";
import { appendClaudeSessionId, appendMessages } from "../taskStateStore";
import type { StoredMessage } from "../taskStateStore";
import { readAllTasks, writeTask } from "../taskStore";

import { extractTextFromLexical } from "../../utils/lexical";
import { extractMessagesFromEvent } from "../../utils/streamMessageExtractor";
import type { Task } from "../../utils/tasks.types";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export { activePtys } from "./taskSpawn";

export async function spawnHandover(
  req: IncomingMessage,
  res: ServerResponse,
  task: Task,
  specText: string,
  resumeId: string | undefined,
): Promise<void> {
  const repos = await readRepos();
  const repo = repos.find((r) => r.name === task.repo);
  const cwd = repo?.path ?? process.cwd();

  let ptyProcess;
  try {
    ptyProcess = spawnClaude(buildArgs(resumeId, specText), cwd);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ type: "error", error: String(err) })}\n`);
    res.end();
    return;
  }

  activePtys.set(task.id, ptyProcess);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "Transfer-Encoding": "chunked",
  });

  let lineBuf = "";
  let latestClaudeSessionId: string | undefined;
  const pendingMessages: StoredMessage[] = [];

  function flushPendingMessages() {
    if (pendingMessages.length === 0) {
      return;
    }
    const toFlush = pendingMessages.splice(0);
    appendMessages(task.repo, task.id, toFlush).catch((err: unknown) => {
      console.error("[taskHandover] Failed to flush messages:", err);
    });
  }

  ptyProcess.onData((data) => {
    const cleaned = stripAnsi(data).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    lineBuf += cleaned;
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("{")) {
        continue;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(t) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed["type"] === "system" && parsed["subtype"] === "init") {
        const sid = parsed["session_id"];
        if (typeof sid === "string") {
          latestClaudeSessionId = sid;
          void (async () => {
            const prevStatus = task.status;
            const updated: Task = {
              ...task,
              status: "In Progress",
              sessionId: sid,
            };
            await writeTask(updated, prevStatus);
            broadcastTaskEvent("task:updated", updated);
            task = updated;
          })().catch((err: unknown) => {
            console.error("[taskHandover] Failed to update task on init:", err);
          });
        }
      }
      if (parsed["type"] === "result") {
        const sid = parsed["session_id"];
        if (typeof sid === "string") {
          latestClaudeSessionId = sid;
        }
        // Flush accumulated messages on each result event
        flushPendingMessages();
      }
      // Accumulate messages from assistant/user events
      const extracted = extractMessagesFromEvent(parsed);
      for (const m of extracted) {
        pendingMessages.push({
          id: randomUUID(),
          role: m.role,
          content: m.content,
          toolName: m.toolName,
          timestamp: new Date().toISOString(),
        });
      }
      res.write(`${t}\n`);
    }
  });

  ptyProcess.onExit(() => {
    activePtys.delete(task.id);
    const t = lineBuf.trim();
    if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t) as Record<string, unknown>;
        if (parsed["type"] === "result") {
          const sid = parsed["session_id"];
          if (typeof sid === "string") {
            latestClaudeSessionId = sid;
          }
          const extracted = extractMessagesFromEvent(parsed);
          for (const m of extracted) {
            pendingMessages.push({
              id: randomUUID(),
              role: m.role,
              content: m.content,
              toolName: m.toolName,
              timestamp: new Date().toISOString(),
            });
          }
        }
        res.write(`${t}\n`);
      } catch {
        /* skip malformed */
      }
    }
    // Final flush of any remaining messages
    flushPendingMessages();
    void (async () => {
      const prevStatus = task.status;
      const newSessionId = latestClaudeSessionId ?? task.claudeSessionId;
      if (newSessionId) {
        await appendClaudeSessionId(task.repo, task.id, newSessionId);
      }
      const updated: Task = {
        ...task,
        status: "Review",
        claudeSessionId: newSessionId,
      };
      delete updated.sessionId;
      await writeTask(updated, prevStatus);
      broadcastTaskEvent("task:updated", updated);
      res.write('{"type":"done"}\n');
      res.end();
    })().catch((err: unknown) => {
      console.error("[taskHandover] Failed to update task on exit:", err);
      res.write('{"type":"done"}\n');
      res.end();
    });
  });

  req.on("close", () => {
    const active = activePtys.get(task.id);
    if (active) {
      try {
        active.kill();
      } catch {
        /* already exited */
      }
      activePtys.delete(task.id);
    }
  });
}

export async function handleHandover(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  const task = await readAllTasks().then((ts) =>
    ts.find((t) => t.id === taskId),
  );
  if (!task) {
    res.writeHead(404);
    res.end();
    return;
  }
  const specText = extractTextFromLexical(task.spec).trim();
  if (!specText) {
    const prevStatus = task.status;
    const reviewTask: Task = { ...task, status: "Review" };
    await writeTask(reviewTask, prevStatus);
    broadcastTaskEvent("task:updated", reviewTask);
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write('{"type":"done"}\n');
    res.end();
    return;
  }
  // Move to "In Progress" immediately so the board updates without waiting for Claude
  const prevStatus = task.status;
  const inProgressTask: Task = { ...task, status: "In Progress" };
  await writeTask(inProgressTask, prevStatus);
  broadcastTaskEvent("task:updated", inProgressTask);
  // Record the initial user message (spec text) as the first stored message
  await appendMessages(task.repo, task.id, [
    {
      id: randomUUID(),
      role: "user",
      content: specText,
      timestamp: new Date().toISOString(),
    },
  ]);
  await spawnHandover(
    req,
    res,
    inProgressTask,
    specText,
    inProgressTask.claudeSessionId,
  );
}

export async function handleRecall(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  const task = await readAllTasks().then((ts) =>
    ts.find((t) => t.id === taskId),
  );
  if (!task) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!task.claudeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No claudeSessionId to resume" }));
    return;
  }
  const specText = extractTextFromLexical(task.spec).trim() || task.title;
  await spawnHandover(req, res, task, specText, task.claudeSessionId);
}
