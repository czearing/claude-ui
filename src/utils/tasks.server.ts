import type { Task } from "./tasks.types.js";

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TASKS_FILE = resolve(process.cwd(), "tasks.json");
const TASKS_TMP = `${TASKS_FILE}.tmp`;

// In-memory store
let tasksMap = new Map<string, Task>();

export function loadTasks(): void {
  try {
    const raw = readFileSync(TASKS_FILE, "utf8");
    const arr = JSON.parse(raw) as Task[];
    tasksMap = new Map(arr.map((t) => [t.id, t]));
  } catch {
    tasksMap = new Map();
  }
}

function saveTasks(): void {
  const arr = Array.from(tasksMap.values());
  writeFileSync(TASKS_TMP, JSON.stringify(arr, null, 2), "utf8");
  renameSync(TASKS_TMP, TASKS_FILE);
}

export function getAllTasks(): Task[] {
  return Array.from(tasksMap.values());
}

export function getTask(id: string): Task | undefined {
  return tasksMap.get(id);
}

export function createTask(title: string, description?: string): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description,
    status: "backlog",
    columnOrder: tasksMap.size,
    createdAt: now,
    updatedAt: now,
  };
  tasksMap.set(task.id, task);
  saveTasks();
  return task;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "status"
    | "columnOrder"
    | "description"
    | "tags"
    | "startedAt"
    | "completedAt"
    | "agentPid"
    | "currentAction"
    | "errorMessage"
  >
>;

export function updateTask(id: string, patch: TaskPatch): Task | undefined {
  const existing = tasksMap.get(id);
  if (!existing) {
    return undefined;
  }
  const updated: Task = {
    ...existing,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  tasksMap.set(id, updated);
  saveTasks();
  return updated;
}

export function deleteTask(id: string): boolean {
  const existed = tasksMap.has(id);
  if (existed) {
    tasksMap.delete(id);
    saveTasks();
  }
  return existed;
}
