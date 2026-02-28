import { spawnHandover } from "./taskHandover";
import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos } from "../repoStore";
import {
  appendMessages,
  getLatestSessionId,
  getTaskState,
} from "../taskStateStore";
import type { StoredMessage, TaskStateEntry } from "../taskStateStore";
import { findTaskById, writeTask } from "../taskStore";
import { parseStringBody } from "../utils/routeUtils";

import { encodeCwdToProjectDir } from "../../utils/captureClaudeSessionId";
import { readBody } from "../../utils/readBody";
import { extractMessagesFromEvent } from "../../utils/streamMessageExtractor";
import type { Task } from "../../utils/tasks.types";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  options?: { label: string; description?: string }[];
};

let _histCounter = 0;
function nextHistId() {
  return `hist-${++_histCounter}`;
}

function parseJsonl(raw: string): HistoryMessage[] {
  const result: HistoryMessage[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) {
      continue;
    }
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const m of extractMessagesFromEvent(entry)) {
      result.push({
        id: nextHistId(),
        role: m.role,
        content: m.content,
        toolName: m.toolName,
        options: m.options,
      });
    }
  }
  return result;
}

async function loadSessionMessages(
  encoded: string,
  sessionId: string,
): Promise<HistoryMessage[]> {
  const filePath = join(
    homedir(),
    ".claude",
    "projects",
    encoded,
    `${sessionId}.jsonl`,
  );
  try {
    const raw = await readFile(filePath, "utf8");
    return parseJsonl(raw);
  } catch {
    return [];
  }
}

async function buildLegacyHistory(
  task: Task,
  state: TaskStateEntry,
): Promise<HistoryMessage[]> {
  const storedUserMessages =
    (state as TaskStateEntry & { userMessages?: string[] }).userMessages ?? [];

  const storedIds = state.claudeSessionIds ?? [];
  const latestSessionId =
    getLatestSessionId(state) ?? task.claudeSessionId ?? null;

  if (!latestSessionId && storedUserMessages.length === 0) {
    return [];
  }

  const repos = await readRepos();
  const repo = repos.find((r) => r.name === task.repo);
  const cwd = repo?.path ?? process.cwd();
  const encoded = encodeCwdToProjectDir(cwd);

  const sessionMessages = latestSessionId
    ? await loadSessionMessages(encoded, latestSessionId)
    : [];

  // If the JSONL already contains user text messages it is a resume session
  // with a full conversation replay — use it directly without prepending stored
  // messages to avoid duplicates.
  const jsonlHasUserText = sessionMessages.some((m) => m.role === "user");

  let messages: HistoryMessage[];
  let processedMsgCount: number;
  if (jsonlHasUserText) {
    messages = [...sessionMessages];
    processedMsgCount =
      storedIds.length > 0 ? storedIds.length : latestSessionId ? 1 : 0;
  } else if (storedUserMessages.length > 0) {
    messages = [
      { id: nextHistId(), role: "user", content: storedUserMessages[0] },
      ...sessionMessages,
    ];
    processedMsgCount = Math.max(
      storedIds.length > 0 ? storedIds.length : latestSessionId ? 1 : 0,
      1,
    );
  } else {
    messages = [...sessionMessages];
    processedMsgCount =
      storedIds.length > 0 ? storedIds.length : latestSessionId ? 1 : 0;
  }

  // Append any pending user messages not yet in a completed session JSONL
  for (const text of storedUserMessages.slice(processedMsgCount)) {
    messages.push({ id: nextHistId(), role: "user", content: text });
  }

  return messages;
}

export async function handleGetHistory(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  const task = await findTaskById(taskId);
  if (!task) {
    res.writeHead(404);
    res.end();
    return;
  }

  const state = await getTaskState(task.repo, taskId);

  // Fast path: if we own the message history, return it directly
  if (state.messages && state.messages.length > 0) {
    const messages: HistoryMessage[] = state.messages.map(
      (m: StoredMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolName: m.toolName,
        options: m.options,
      }),
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messages));
    return;
  }

  // Fallback: legacy JSONL + userMessages reconstruction for older tasks
  const messages = await buildLegacyHistory(task, state);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(messages));
}

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  const task = await findTaskById(taskId);
  if (!task) {
    res.writeHead(404);
    res.end();
    return;
  }
  const body = await readBody(req);
  const message = parseStringBody(body, "message");

  // Move to "In Progress" immediately so the board updates without waiting for Claude
  let activeTask = task;
  if (task.status !== "In Progress") {
    const prevStatus = task.status;
    activeTask = { ...task, status: "In Progress" };
    await writeTask(activeTask, prevStatus);
    broadcastTaskEvent("task:updated", activeTask);
  }
  await appendMessages(task.repo, task.id, [
    {
      id: randomUUID(),
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    },
  ]);
  await spawnHandover(
    req,
    res,
    activeTask,
    message,
    activeTask.claudeSessionId,
    false, // use -p (batch) mode — interactive mode with --resume is unreliable on Windows
  );
}
