import type { Task } from "./tasks.types";

/**
 * Generate the next sequential task ID (e.g. "TASK-003") from an in-memory
 * list of tasks.
 *
 * Scans all task IDs for the maximum numeric suffix, then returns max + 1,
 * zero-padded to three digits.  Non-TASK-NNN IDs are ignored.
 */
export function generateTaskId(tasks: Task[]): string {
  const maxNum = tasks.reduce((max, t) => {
    const num = parseInt(t.id.replace("TASK-", ""), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `TASK-${String(maxNum + 1).padStart(3, "0")}`;
}
