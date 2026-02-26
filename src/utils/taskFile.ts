import type { Priority, Task, TaskStatus } from "./tasks.types";

/**
 * Parse a markdown task file (frontmatter + body) into a Task object.
 *
 * Format:
 *   ---
 *   id: TASK-001
 *   title: My task
 *   status: In Progress
 *   ...
 *   ---
 *
 *   Spec body (plain text markdown)
 *
 * Throws when the frontmatter delimiters are absent.
 */
export function parseTaskFile(content: string): Task {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) throw new Error("Invalid task file: missing frontmatter");
  const frontmatter = match[1];
  const body = match[2].trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 2).trim();
    if (key) meta[key] = value;
  }

  const task: Task = {
    id: meta["id"] ?? "",
    title: meta["title"] ?? "",
    status: (meta["status"] as TaskStatus) ?? "Backlog",
    priority: (meta["priority"] as Priority) ?? "Medium",
    repoId: meta["repoId"] ?? "",
    spec: body,
    createdAt: meta["createdAt"] ?? new Date().toISOString(),
    updatedAt: meta["updatedAt"] ?? new Date().toISOString(),
  };
  if (meta["sessionId"]) task.sessionId = meta["sessionId"];
  if (meta["archivedAt"]) task.archivedAt = meta["archivedAt"];
  return task;
}

/**
 * Serialize a Task into the markdown file format (frontmatter + body).
 * Round-trips cleanly with parseTaskFile.
 */
export function serializeTaskFile(task: Task): string {
  const lines = [
    "---",
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `priority: ${task.priority}`,
    `repoId: ${task.repoId}`,
  ];
  if (task.sessionId) lines.push(`sessionId: ${task.sessionId}`);
  if (task.archivedAt) lines.push(`archivedAt: ${task.archivedAt}`);
  lines.push(`createdAt: ${task.createdAt}`);
  lines.push(`updatedAt: ${task.updatedAt}`);
  lines.push("---");
  lines.push("");
  if (task.spec) lines.push(task.spec);
  return lines.join("\n");
}
