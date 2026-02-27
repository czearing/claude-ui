import type { Task, TaskStatus } from "./tasks.types";
import { titleFromSlug } from "./taskSlug";

/**
 * Parse a plain-text markdown task file into a Task object.
 *
 * The file content IS the spec -- no frontmatter, no YAML headers.
 * Title is derived from the filename slug via titleFromSlug.
 * Status is set by the caller based on the folder the file lives in.
 * sessionId and archivedAt come from the sidecar taskStateStore.
 */
export function parseTaskFile(
  content: string,
  repo: string = "",
  id: string = "",
  status: TaskStatus = "Backlog",
): Task {
  return {
    id,
    title: titleFromSlug(id),
    status,
    repo,
    spec: content.trim(),
  };
}

/**
 * Serialize a Task into the plain-text file format.
 * Returns just the spec text -- nothing else.
 */
export function serializeTaskFile(task: Task): string {
  return task.spec ?? "";
}
