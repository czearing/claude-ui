import { spawnHandover } from "./taskHandover";
import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos } from "../repoStore";
import {
  appendMessages,
  getLatestSessionId,
  getTaskState,
} from "../taskStateStore";
import type { StoredMessage, TaskStateEntry } from "../taskStateStore";
import { readAllTasks, writeTask } from "../taskStore";
import { parseStringBody } from "../utils/routeUtils";

import { encodeCwdToProjectDir } from "../../utils/captureClaudeSessionId";
import { readBody } from "../../utils/readBody";
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
    const type = entry["type"] as string | undefined;
    if (type === "assistant") {
      const msg = entry["message"] as
        | { content?: { type: string; text?: string; name?: string }[] }
        | undefined;
      for (const block of msg?.content ?? []) {
        if (block.type === "text" && block.text) {
          result.push({
            id: nextHistId(),
            role: "assistant",
            content: block.text,
          });
        } else if (block.type === "tool_use") {
          result.push({
            id: nextHistId(),
            role: "tool",
            content: "",
            toolName: block.name ?? "tool",
          });
        }
      }
    } else if (type === "user") {
      const msg = entry["message"] as
        | {
            content?: {
              type: string;
              tool_use_id?: string;
              content?: unknown;
              text?: string;
            }[];
          }
        | undefined;
      for (const block of msg?.content ?? []) {
        if (block.type === "tool_result") {
          const rawContent = block.content as
            | string
            | { type: string; text: string }[]
            | undefined;
          const text =
            typeof rawContent === "string"
              ? rawContent
              : Array.isArray(rawContent)
                ? rawContent
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("")
                : "";
          result.push({ id: nextHistId(), role: "system", content: text });
        } else if (block.type === "text" && block.text) {
          result.push({
            id: nextHistId(),
            role: "user",
            content: block.text,
          });
        }
      }
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
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.id === taskId);
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
  const tasks = await readAllTasks();
  const task = tasks.find((t) => t.id === taskId);
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
  );
}
