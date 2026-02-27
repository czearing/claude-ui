// src/utils/tasks.types.ts
export type TaskStatus =
  | "Backlog"
  | "Not Started"
  | "In Progress"
  | "Review"
  | "Done";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  spec: string; // Lexical editor state JSON
  repo: string; // repo name (e.g. "book-cook"), encoded in folder path
  sessionId?: string; // linked Claude PTY session
  archivedAt?: string; // ISO timestamp, set when status → "Done"
}

export type CreateTaskInput = Pick<Task, "title" | "repo"> & {
  status?: TaskStatus;
};
export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "status" | "spec" | "sessionId" | "archivedAt">
>;
